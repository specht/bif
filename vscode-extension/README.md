# BIF Authoring Tools

BIF Authoring Tools adds read-only diagnostics and a complete project graph to
VS Code projects that use the BIF Markdown interactive-fiction player.

Features:

- analyzer errors and warnings in the Problems panel;
- automatic saved-file refresh with debounced filesystem watchers;
- a status-bar page/error/warning summary;
- a complete offline graph containing unreachable pages and missing targets;
- copyable source locations and links back to VS Code.

After each latest saved-file analysis, the extension writes
`.story-tools/analysis.json`. This Git-ignored, versioned JSON file is a
deterministic, non-executable snapshot used by the browser development summary
and intended for a future browser Project mode. It contains relative source
locations only, is generated even when no browser is open, and should not be
deployed with the normal reader site.

Commands are available as **BIF: Refresh Story Diagnostics**, **BIF: Open Story
Graph**, **BIF: Show Story Summary**, and **BIF: Show Output**.

The extension recognizes `config.js` at each workspace-folder root. It analyzes
saved filesystem content only, never executes story scripts, and never changes
stories. Background analysis updates `.story-tools/analysis.json`. Standalone
graph export remains a separate, explicit command that writes
`.story-tools/graph.html`; it is disabled in untrusted workspaces.

The extension is the VS Code adapter over the repository's shared Node
analysis/publication service. That shared service owns analyzer invocation,
publication construction, canonical hashing, and atomic file replacement. The
extension continues to own workspace discovery, watchers, generation
scheduling, Problems diagnostics, status and output, commands, and editor UI;
it does not spawn npm or parse CLI output.

## Development

```bash
npm install
npm run check-types
npm test
npm run package
```

Press F5 from this directory to open an Extension Development Host. The static
player remains independent of the extension and requires no build step.

Main project: https://github.com/gymnasiumsteglitz/bif-authoring-tools
