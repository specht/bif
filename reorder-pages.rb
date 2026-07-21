#!/usr/bin/env ruby

require 'set'
require 'yaml'

class Parser
    def initialize
        content = File.read("config.js")
        @path = nil

        if content =~ /path\s*=\s*"([^"]+)"/
            @path = $1
        end

        if @path.nil?
            raise "No path could be determined from looking at config.js"
        end

        unless File.directory?(@path)
            raise "No pages found in #{@path}!"
        end

        STDERR.puts "Reading pages from directory: #{@path}"
    end

    def extract_links(content, only_internal: true)
        cleaned = content
        .gsub(/<script\b[^>]*>.*?<\/script>/m, "")
        .gsub(/<!--.*?-->/m, "")
        .gsub(/\[\[[^\]]+\]\]/, "")

        links = []
        links += cleaned.scan(/(?<!!)\[[^\]]+\]\(([^)]+)\)/).flatten
        links += cleaned.scan(/<a\s+[^>]*href=["']([^"']+)["']/i).flatten
        links = links.select do |x|
            x =~ /^[a-zA-Z0-9_]+$/
        end

        if only_internal
            links.select! { |t| t.match?(/\A\d+[a-z]?\z/i) }
        end

        links.uniq
    end


    def handle_file(id)
        path = File.join(@path, "#{id}.md")
        return Set.new([]) unless File.exist?(path)
        links = Set.new(extract_links(File.read(path)))
    end

    # ---------- Deterministic ordering helpers ----------

    # Natural-ish order for ids like "1", "1a", "12b"; falls back to lexicographic.
    def order_key(id)
        s = id.to_s
        if s =~ /\A(\d+)([A-Za-z]*)\z/
            [$1.to_i, $2.downcase]
        else
            [Float::INFINITY, s]
        end
    end

    def sorted(enum)
        enum.to_a.sort_by { |x| order_key(x) }
    end

    # ---------- Public API ----------

    # links: { node => Set[child, ...] }
    # start: optional start node; if nil, layer from all sources (in-degree 0)
    # Returns [layers_hash, ordered_nodes_array]
    def graphviz_like_layers(links, start: nil)
        links = normalize_links(links)

        # 1) Strongly Connected Components (Kosaraju)
        sccs, comp_of = scc_kosaraju(links)

        # 2) Condense SCCs to a DAG
        dag = condense_to_dag(links, comp_of, sccs.size)

        # 3) Longest-path layering on DAG
        comp_layers = longest_path_layers(
        dag,
        start_comp: (start && comp_of[start]),
        from_all_sources: start.nil?
        )

        # 4) Assign each original node its component's layer
        layers = {}
        sccs.each_with_index do |nodes, cid|
            layer = comp_layers[cid]
            nodes.each { |n| layers[n] = layer }
        end

        # 5) Deterministic overall order: by layer, then BFS-from-start (optional), then id
        tiebreak = start ? bfs_order(start, links) : []
        pos = {}
        tiebreak.each_with_index { |n, i| pos[n] = i }

        ordered = sorted(layers.keys).sort_by do |n|
            [layers[n] || Float::INFINITY, pos.fetch(n, Float::INFINITY), order_key(n)]
        end

        [layers, ordered]
    end

    # ---------- Utilities ----------

    def normalize_links(links)
        all = Set.new(links.keys)
        links.each_value { |cs| cs.each { |c| all << c } }
        all.to_h { |n| [n, Set.new(links[n] || [])] }
    end

    # Iterative Kosaraju with deterministic neighbor order.
    def scc_kosaraju(links)
        nodes = sorted(links.keys)

        # Build reverse graph
        rev = Hash.new { |h, k| h[k] = Set.new }
        nodes.each { |u| rev[u] ||= Set.new }
        nodes.each do |u|
            sorted(links[u]).each { |v| rev[v] << u }
        end

        visited = Set.new
        finish_order = []

        # DFS1: record finish order
        nodes.each do |u|
            next if visited.include?(u)
            stack = [[u, :enter, sorted(links[u]).each]]
            visited << u
            until stack.empty?
                node, state, it = stack.pop
                if state == :enter
                    # Try to go deeper
                    begin
                        while (nxt = it.next)
                            unless visited.include?(nxt)
                                visited << nxt
                                stack << [node, :enter, it]
                                stack << [nxt, :enter, sorted(links[nxt]).each]
                                break
                            end
                        end
                    rescue StopIteration
                        finish_order << node
                    end
                end
            end
        end

        # DFS2 on reversed graph, in decreasing finish order
        visited.clear
        comp_of = {}
        sccs = []

        finish_order.reverse_each do |u|
            next if visited.include?(u)
            comp = []
            stack = [u]
            visited << u
            until stack.empty?
                x = stack.pop
                comp << x
                comp_of[x] = sccs.size
                sorted(rev[x]).each do |y|
                    next if visited.include?(y)
                    visited << y
                    stack << y
                end
            end
            sccs << sorted(comp)
        end

        [sccs, comp_of]
    end

    def condense_to_dag(links, comp_of, comp_count)
        dag = Array.new(comp_count) { Set.new }
        links.each do |u, cs|
            cu = comp_of[u]
            sorted(cs).each do |v|
                cv = comp_of[v]
                dag[cu] << cv if cu != cv
            end
        end
        dag
    end

    # Longest path layering on a DAG (edge weight = 1).
    # If start_comp is given, distance[start]=0 and others are unreachable unless connected.
    # If from_all_sources, all sources (in-degree 0) start at 0.
    def longest_path_layers(dag, start_comp: nil, from_all_sources: false)
        n = dag.size
        indeg = Array.new(n, 0)
        dag.each { |outs| sorted(outs).each { |v| indeg[v] += 1 } }

        # Deterministic Kahn topo
        topo = []
        q = sorted((0...n).select { |i| indeg[i].zero? })
        until q.empty?
            u = q.shift
            topo << u
            sorted(dag[u]).each do |v|
                indeg[v] -= 1
                q << v if indeg[v].zero?
            end
            q = sorted(q)
        end

        topo = sorted(0...n) if topo.empty? && n > 0

        neg_inf = -1 << 60
        dist = Array.new(n, neg_inf)

        if start_comp
            dist[start_comp] = 0
        elsif from_all_sources
            # all sources at 0
            sources = Array.new(n, true)
            dag.each_with_index { |outs, u| sorted(outs).each { |v| sources[v] = false } }
            sources.each_with_index { |is_src, i| dist[i] = 0 if is_src }
        else
            dist.fill(0)
        end

        topo.each do |u|
            next if dist[u] == neg_inf
            sorted(dag[u]).each do |v|
                dist[v] = [dist[v], dist[u] + 1].max
            end
        end

        dist.map! { |d| d == neg_inf ? nil : d }
        dist
    end

    # Deterministic BFS order (used only as a tie-breaker in final ordering).
    def bfs_order(start, links)
        visited = Set.new([start])
        q = [start]
        order = []
        until q.empty?
            u = q.shift
            order << u
            sorted(links[u]).each do |v|
                next if visited.include?(v)
                visited << v
                q << v
            end
        end
        order
    end

    def parse()
        seen_entries = Set.new()
        wavefront = Set.new(['1'])

        links = {}

        while !wavefront.empty?
            seen_entries |= wavefront
            new_wavefront = Set.new()
            wavefront.each do |id|
                children = handle_file(id)
                new_wavefront |= children
                children.each do |cid|
                    links[id] ||= Set.new()
                    links[id] << cid
                end
            end
            new_wavefront -= seen_entries
            wavefront = new_wavefront
        end
        STDERR.puts "Done reading #{links.size} pages, now extracting links..."
        layers, order = graphviz_like_layers(links, start: "1")
        tr = {}
        order.each.with_index do |id, index|
            new_id = "#{index + 1}"
            if id != new_id
                tr[id] = new_id
            end
        end
        if tr.empty?
            STDERR.puts "Links are perfectly sorted, nothing to do!"
            exit(0)
        end
        STDERR.puts tr.to_yaml
    end
end

parser = Parser.new()
parser.parse()
