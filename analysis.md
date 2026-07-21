# Existing Interactive Fiction Project — Baseline Analysis

## Scope and verification

This report analyses the uploaded `interactive-fiction.zip` as the baseline project.

Inspected:

- `index.html`
- `config.js`
- all of `lib/script.js`
- all CSS
- all Markdown files in `pages/`, `pages-heros/`, and `pages-city/`
- the Graphviz/Markdown/runtime dependencies
- local fonts and images
- `reorder-pages.rb`

Verification performed:

- `lib/script.js` and `config.js` pass JavaScript syntax checking.
- Every embedded `<script>` block, condition, and inline expression in the three story sets is syntactically valid JavaScript.
- The Ruby reordering tool fails under its default encoding and succeeds when Ruby is explicitly forced to UTF-8.
- No project files were modified.

This is primarily a code-level and structural analysis. The supplied screenshots were also used to assess the current interaction design.

---

# 1. Executive assessment

The existing project is not a disposable prototype. It already contains the core of a distinctive interactive-fiction engine:

- completely static deployment;
- root-level `index.html`;
- Markdown page files;
- an accumulating transcript rather than page replacement;
- deterministic seeded randomness;
- session reconstruction from the URL;
- persistent story variables and functions;
- embedded executable JavaScript;
- conditional content and conditional choices;
- inline expressions;
- dynamically printed Markdown;
- asynchronous scripted choices;
- a grouped Graphviz story map;
- route highlighting;
- graph-based story navigation and rewind;
- a live variable display;
- local fonts and assets;
- automatic dark mode.

The strongest part is the product model: the transcript, graph, state, and URL history are directly connected.

The weakest part is engineering structure. Nearly all functionality is concentrated in one 1,080-line browser module, with no tests, reusable parser, error model, or clear runtime contract. Several important bugs are present.

The correct strategy is therefore:

> Preserve the current player and its interaction model, document its semantics, fix correctness issues, and extract reusable modules incrementally.

A clean-room rewrite is unnecessary and considerably riskier.

---

# 2. Project inventory

## Top-level structure

```text
interactive-fiction/
├── index.html
├── config.js
├── styles.css
├── reorder-pages.rb
├── README.md
├── lib/
├── fonts/
├── images/
├── pages/
├── pages-heros/
└── pages-city/
```

Approximate total size: **8.4 MB**

Main contributors:

- vendored JavaScript libraries: about **947 KB**
- local fonts: about **1.7 MB**
- images: about **5.8 MB**
- all three story collections together: under **50 KB**

## Vendored runtime dependencies

The repository is build-free and contains browser-ready dependencies:

- `@hpcc-js/wasm` Graphviz 2.25.0
- `markdown-it` 14.1.0
- `markdown-it-attrs` 4.3.1
- `js-yaml` 4.1.0
- LZ-String
- Markdown-it transitive dependencies

This is a useful property for Hackschule deployment: no package installation or compilation is necessary to play a story.

## Fonts

The project already serves fonts locally:

- IBM Plex Sans variable regular and italic
- IBM Plex Mono regular, bold, italic, and bold italic
- OFL licence file included

This already satisfies the important requirement that a published story be self-contained and not contact Google Fonts at runtime.

The files are TTF rather than WOFF2, so they can later be made smaller, but the underlying model is good.

---

# 3. Current configuration model

`config.js` exports only:

```js
export const title = "Die List des Odysseus";
export const path = "pages";
```

This selects one page directory and sets the document title.

The three story collections are therefore alternate projects inside one repository:

- `pages/`: active Odysseus story
- `pages-heros/`: smaller tutorial/demo story
- `pages-city/`: incomplete and more technically ambitious experiment

## Current implicit assumptions

Several important settings are hard-coded rather than configured:

- the start page is always `1.md`;
- Markdown filenames are addressed without the `.md` suffix;
- internal links are links whose `href` contains no slash;
- page assets are resolved from the website root;
- debug mode is enabled automatically when the URL has a port;
- the graph begins at page `1`;
- page IDs are expected to be simple strings;
- the URL history is a comma-separated token sequence before compression.

These are not necessarily wrong, but they need to become explicit contracts or configurable values.

---

# 4. Story format currently supported

The existing syntax is compact and surprisingly expressive.

## 4.1 Page metadata

The first HTML comment provides grouping and an optional graph summary:

```markdown
<!-- Höhle -- Wein anbieten -->
```

Meaning:

- group: `Höhle`
- concise graph label: `Wein anbieten`

A group without a summary is also supported:

```markdown
<!-- Piratenschiff -->
```

This is valuable because graph labels can remain short without forcing a heading into the visible story.

## 4.2 Navigation choices

Bare page IDs are used:

```markdown
- [Du gehst in die Höhle.](4)
```

The runtime fetches:

```text
pages/4.md
```

Choices can have a shorter graph label:

```markdown
- [Ich schleiche mich an die Wache heran.](120){label="Wache angreifen"}
```

## 4.3 Executable page JavaScript

Raw `<script>` blocks execute while the page DOM is processed:

```html
<script>
    crew_count -= 2;
</script>
```

Page scripts can:

- create variables;
- modify variables;
- define persistent functions;
- call functions defined on earlier pages;
- call runtime helpers;
- use seeded random numbers;
- initiate asynchronous interactions.

## 4.4 Persistent state and functions

Assignments to undeclared identifiers are captured by a Proxy-backed shared context:

```js
crew_count = 12;
polyphem_drunk = false;
```

Functions can also persist:

```js
versuche_glueck = function() {
    ...
}
```

This makes the first page capable of defining a small rules engine used by later pages.

## 4.5 Inline expressions

Two forms are supported:

```markdown
Du gehst mit [[crew_count]] Männern an Land.
```

and:

```html
<span expression="hp"></span>
```

The expression result is inserted as text.

## 4.6 Conditional content

Any HTML subtree can have a condition:

```html
<div condition="polyphem_drunk">
    ...
</div>
```

This supports conditional:

- prose;
- images;
- complete sections;
- navigation choices;
- inline spans.

Markdown attributes also allow conditional choices:

```markdown
- [Du benutzt dein Schwert.](3b) { condition="sword" }
```

## 4.7 Dynamic Markdown output

Page code can append new rendered Markdown:

```js
print("> *Du versuchst dein Glück.*");
```

This is a powerful capability for combat, dialogue, dice rolls, and state feedback.

## 4.8 Scripted temporary choices

Page code can pause on an asynchronous choice:

```js
const answer = await presentChoice([
    ["luck", "Glück versuchen"],
    ["fight", "Weiterkämpfen"]
]);
```

These choices are not necessarily page transitions. Their answers become part of URL history so the sequence can be replayed.

This is one of the most advanced and valuable features in the project.

---

# 5. Runtime architecture

Almost the complete engine lives in `lib/script.js`.

## Main mutable state

```js
let history = [];
let context = {};
let nextPageLinks = {};
let deferred = null;
```

Conceptually:

- `history` records the deterministic session;
- `context` stores story variables and functions;
- `nextPageLinks` connects current page targets to DOM elements;
- `deferred` represents an active scripted choice.

## Context Proxy

The Proxy provides:

- reads and writes to story state;
- fallback access to browser globals;
- `print`;
- `presentChoice`;
- intended programmatic navigation.

Story code is executed with:

```js
Function('ctx', `with (ctx) { ${code} }`)(contextProxy);
```

This gives stories genuine JavaScript with a shared namespace.

## Page loading lifecycle

For an ordinary page transition:

1. Fetch `/{path}/{page}.md`.
2. Render Markdown to HTML.
3. Convert `[[ expression ]]` into expression nodes.
4. collect static links;
5. recursively process the DOM;
6. evaluate conditions;
7. evaluate inline expressions;
8. execute scripts in document order;
9. append the resulting content to the transcript;
10. add the page to history;
11. update the URL hash;
12. convert internal links into story choices;
13. add a restart button if no choices remain;
14. update graph highlighting;
15. scroll toward the selected choice.

## Important semantic property: document order

Scripts are executed where they appear in the page.

That means a script can affect only content processed after it unless the affected state already existed.

For example:

```markdown
<script>
    success = Math.chance(50);
</script>

<div condition="success">
...
</div>
```

This ordering is meaningful and should be documented before refactoring.

---

# 6. Transcript model

The browser does not replace one page with another.

Instead:

- every visited passage remains visible;
- a horizontal separator is appended;
- the selected choice remains;
- rejected choices collapse;
- the next passage appears below;
- the browser scrolls onward.

This is the key reason the old player feels more natural than the rewrite.

It resembles a continuously unfolding narrative rather than a stack of disconnected HTML documents.

## What is already strong

- readable width of roughly 30 em;
- local humanist font;
- natural paragraph flow;
- integrated images;
- retained narrative history;
- clear choice buttons;
- automatic terminal restart;
- no irritating character-by-character typewriter effect.

## Current limitation

Passages are not wrapped in identifiable page containers. The transcript is essentially a flat DOM stream separated by `<hr>` elements.

That makes it difficult to:

- scroll directly to a specific visited page;
- highlight a passage from the graph;
- collapse earlier passages;
- attach debug information to one passage;
- inspect which DOM came from which source file.

Adding page wrappers with stable IDs would be a high-value internal improvement that need not change the appearance.

---

# 7. URL state and deterministic replay

The session is stored in `history`.

The first item is a random seed. Later items are:

- page IDs;
- scripted choice answers.

The sequence is joined with commas, compressed using LZ-String, and written to the URL hash.

Example conceptual history:

```text
[seed, "1", "4", "6", "10", "11", "13"]
```

On reload:

1. the seed resets `Math.random`;
2. the story starts again;
3. every page and temporary choice is replayed;
4. state and printed output are reconstructed.

## Strengths

- a URL can represent the whole game;
- random events are reproducible;
- no backend or database is needed;
- state does not need to be serialized directly;
- functions and derived state are recreated by replay;
- shared URLs can reproduce a route.

This is a strong architectural idea and should be retained.

## Problems

### Initial-page refresh loses the seed

A restored history with fewer than three tokens is treated as a new game.

After loading only page 1, history is normally:

```text
[seed, "1"]
```

Refreshing at this point creates a new seed rather than restoring the same session.

### Browser Back and Forward do not rebuild the transcript

Changing `location.hash` creates browser history entries, but there is no `hashchange` or `popstate` handler.

The URL may move backward while the visible transcript and state remain unchanged until a full reload.

### Page IDs and scripted answers share one untyped token stream

A temporary answer such as `"y"` is indistinguishable from a page ID.

This causes ambiguity and also disrupts graph route highlighting.

### Commas are not escaped

Any page or answer containing a comma would corrupt the token sequence.

### No format version or story revision

An old URL can be replayed against a changed story with undefined results.

A future format should use typed, versioned events while retaining the replay principle.

---

# 8. Randomness

The engine replaces global `Math.random` with a seeded Mulberry32 generator.

It also defines:

```js
Math.chance = (x) => Math.random() * 100 < x;
```

This enables reproducible probabilistic branches.

## Bug

The convenience function is currently:

```js
Math.w6 = () => Math.floor(Math.rand() * 6) + 1;
```

`Math.rand()` does not exist.

The included stories avoid this by defining their own `w6`, but the engine helper is broken.

## Design concern

Replacing global `Math.random` affects every script running on the page, including player and library code.

A dedicated story random API would be safer, but deterministic story randomness should absolutely be preserved.

---

# 9. Graph system

The browser graph is generated dynamically in debug/development mode.

## Discovery

Starting from page `1`, the engine:

1. fetches each reachable Markdown file;
2. parses metadata and links;
3. follows links breadth-first;
4. generates DOT;
5. renders it with Graphviz WASM.

## Grouping

Page groups become Graphviz clusters.

Each group receives a deterministic color derived from its label.

Ungrouped pages appear outside clusters.

## Labels

Nodes use:

- page ID;
- optional page summary from the metadata comment.

Edges can use the optional Markdown `label` attribute.

## Gameplay integration

The graph is not merely decorative.

It:

- highlights visited nodes;
- highlights traversed edges;
- lets the player select currently available destination nodes;
- lets the player click an earlier visited node to reconstruct the story up to that point;
- supports mouse and touch pan and zoom.

This direct coupling to gameplay is a major feature worth protecting.

## Current limitations and bugs

### Only reachable pages are shown

Unreachable files are invisible.

That is appropriate for a gameplay graph but insufficient for an authoring/validation graph.

### Missing pages are not clearly diagnosed

A missing target becomes a fetch failure and a minimal node, but it is not given a strong, explicit error style or source diagnostic.

### Scripted choices corrupt route highlighting

History contains both page IDs and temporary answers.

Graph highlighting treats every token as a page, so the route can break after `presentChoice()`.

### Distinct choices to the same target collapse

Edges are deduplicated by:

```text
source -> target
```

Two different decisions leading to the same page become one edge.

Link labels are also indexed only by target, so one can overwrite another.

### DOT text is not escaped robustly

Quotes, backslashes, or unusual metadata can break the generated DOT.

### The graph reloads the complete reachable story

For a large story, debug startup requires one HTTP request per reachable page.

This is acceptable for small stories but will become expensive for book-sized projects.

### No viewport persistence

Pan and zoom reset after reload.

### Fixed light-oriented graph colors

Graph nodes and edges use fixed black strokes and pastel fills. Dark mode is not handled comprehensively.

---

# 10. Developer/debug interface

Debug mode is enabled when:

```js
window.location.port.length > 0
```

or when the query contains `dev`.

Since Live Server normally uses a port, development mode appears automatically.

The layout contains:

- graph pane;
- resizable divider;
- live state dump;
- transcript pane;
- reset button.

The split percentage is stored in `localStorage`.

## Strengths

- extremely low-friction development workflow;
- graph and story visible simultaneously;
- live state display;
- no extra developer server;
- split size remembered.

## Problems

### Debug mode is inferred too broadly

Any deployment using a nonstandard port receives the developer interface.

An explicit query parameter or configuration switch would be clearer.

### Resize bug

The window resize handler assigns the saved left percentage to both panes rather than assigning the complement to the right pane.

### State reset/rewind bug

This is one of the most serious correctness issues.

`contextProxy` is created once with the original `context` object as its target.

During graph rewind, the code does:

```js
context = {};
```

This changes the variable but does not change the Proxy target.

Consequences:

- old story state is not actually cleared;
- replay may continue with stale variables and functions;
- the visible state dump may refer to the new empty object while story code still uses the old Proxy target;
- graph rewind can produce incorrect and confusing results.

The state object should be cleared in place or the runtime context and Proxy should be recreated together.

---

# 11. Dynamic scripted interactions

The `pages-city` example demonstrates an ambitious combat engine.

The initial page defines:

- dice;
- luck tests;
- stat modification;
- an asynchronous combat loop;
- temporary decisions inside combat;
- dynamic Markdown output;
- hook callbacks;
- intended automatic navigation after victory.

This proves that the engine can support much more than simple choose-your-own-adventure links.

## Critical broken feature

The Proxy exposes `forceTurnToPage`, but its implementation is commented out.

When the combat code wins and attempts:

```js
await forceTurnToPage(options.pageAfterWin);
```

the runtime will fail.

## Async execution is not awaited by page processing

`runInContext()` can return a Promise, but `processDOM()` does not await it.

This currently works partially because an async function runs synchronously until its first `await`, allowing `presentChoice()` to create buttons.

However, the overall lifecycle is implicit and race-prone:

- the page is added to history while script execution may still be active;
- terminal-page detection can race with dynamic controls;
- exceptions from asynchronous work are not handled by the page-loading chain;
- navigation can occur outside the normal transition contract.

Before extending dynamic code, page execution needs an explicit asynchronous lifecycle.

---

# 12. Error handling

Current error handling is not adequate for classroom use.

## Page load errors

The `appendPage()` catch block always reports:

```text
Fehler: Seite X nicht gefunden.
```

But the catch also receives errors from:

- invalid page JavaScript;
- invalid inline expressions;
- Markdown/DOM processing;
- runtime helper errors;
- state serialization;
- graph integration.

A JavaScript error can therefore be falsely reported as a missing file.

## Conditions

Condition evaluation catches every exception and silently returns false.

A misspelled variable can make content disappear without any explanation.

## Expressions

Inline expression errors are not caught locally and can abort the whole page.

## Async errors

Errors from ongoing async story functions may become unhandled Promise rejections.

## Source positions

The engine has no line/column mapping back to the Markdown file.

Improving error reporting should be one of the earliest engineering tasks.

---

# 13. Security and execution boundaries

The current engine assumes trusted story authors.

It enables:

- raw HTML in Markdown;
- arbitrary `<script>` execution;
- `Function`;
- `with`;
- access to `globalThis`;
- access to `window`, `document`, `fetch`, `localStorage`, and other browser APIs;
- unsanitized dynamic HTML through author code.

For a personal/classroom authoring system deployed on isolated static subdomains, this may be an acceptable trust model.

It is not a secure sandbox.

The key requirement is to document this honestly. A Web Worker or restricted API can be considered later, but moving the runtime into a sandbox would be a substantial semantic change and should not be the first refactoring step.

---

# 14. Styling and responsive behaviour

## Existing strengths

- local IBM Plex typography;
- light and dark foreground/background variables;
- semantic readable line width;
- full-width responsive images;
- styled blockquotes and tables;
- restrained choice buttons;
- animated choice dismissal;
- split-pane debug layout;
- graph pan/zoom;
- system dark-mode detection.

## Modern-browser dependencies

The CSS uses:

- native nesting;
- `:has()`;
- `color-mix()`.

This is fine for current Chromium-based school environments, but it is an implicit browser requirement.

## Accessibility problems

### Normal story choices lose keyboard access

Internal anchors have their `href` removed.

When the anchor is inside a list item, the click handler and `.pagelink` class are applied to the `<li>`.

Neither the anchor without an `href` nor the list item is keyboard-focusable by default.

As a result, ordinary navigation choices are effectively mouse/touch only.

Scripted choices use real `<button>` elements and are better.

### Other accessibility gaps

- no `lang` attribute on `<html>`;
- current sample images use raw `<img>` without alt text;
- graph nodes are mouse-clickable SVG groups without keyboard semantics;
- no ARIA labels;
- motion preferences are not respected automatically;
- active/inactive graph state relies heavily on opacity and color;
- no explicit focus styling for story navigation because choices are not focusable.

These can be improved without changing the visual design.

---

# 15. Deployment properties

## Excellent existing property

`index.html` already lives in the root.

Opening the folder and pressing **Go Live** is the correct workflow.

## Current path limitation

Most URLs are root-absolute:

```text
/lib/script.js
/styles.css
/fonts/fonts.css
/{pagesDirectory}/{page}.md
/
```

This works when the story is deployed at the domain root, such as a dedicated Hackschule subdomain.

It does not work reliably when deployed below a path such as:

```text
https://example.org/stories/my-story/
```

Relative URLs would make the project more portable.

## Cache behaviour

The player adds a timestamp query parameter to scripts, CSS, configuration, and Markdown pages.

This is useful during authoring because Live Server refreshes always receive current files.

It also disables useful caching in production.

An explicit development mode could preserve cache busting only while editing.

---

# 16. Story collection assessment

## Active Odysseus story: `pages/`

Metrics:

- 13 pages
- 21 internal link occurrences
- 13 reachable pages
- no missing page targets
- no unreachable pages
- 3 groups:
  - Insel: 3 pages
  - Höhle: 9 pages
  - Schiff: 1 page
- 6 script blocks
- 7 conditional elements
- 2 inline expressions
- 2 terminal pages

This collection is internally coherent and is the best baseline regression story.

It exercises:

- initial state;
- state changes;
- conditional prose;
- conditional branches;
- deterministic chance;
- success and failure endings;
- graph groups;
- graph summaries;
- images;
- inline state display.

## Hero story: `pages-heros/`

Metrics:

- 12 files
- 11 reachable from page 1
- 1 unreachable file: `152.md`
- 1 missing target: `20`
- 10 script blocks
- 9 conditional elements
- 3 inline expressions

`152.md` appears to be an accidental copy from the city story.

The rest is a useful small teaching story for:

- inventory flags;
- conditional choices;
- hit points;
- probabilistic outcomes;
- multiple routes.

## City excerpt: `pages-city/`

Metrics:

- 16 existing page files
- all existing files are reachable through the current excerpt graph
- 5 missing target pages:
  - `78`
  - `226`
  - `284`
  - `383`
  - `386`
- no terminal existing page
- 7 script blocks
- 7 conditional elements
- 6 genuine inline expressions
- advanced combat and temporary choices

This is explicitly an incomplete excerpt and should be treated as a stress-test fixture rather than a polished story.

It reveals the engine’s most advanced ambitions, but the missing `forceTurnToPage()` implementation prevents combat victory navigation from working.

---

# 17. Ruby reordering experiment

`reorder-pages.rb` contains useful graph-ordering ideas.

## Current behaviour

It:

1. reads the active `path` from `config.js`;
2. begins at page `1`;
3. scans reachable internal links;
4. computes strongly connected components with Kosaraju;
5. condenses loops into a DAG;
6. uses longest-path layering;
7. applies deterministic BFS and natural-ID tie breaking;
8. calculates a proposed new numbering;
9. prints the translation as YAML.

## Strength

The SCC-based ordering is more suitable than a simple filename sort because interactive stories contain loops.

## Current limitations

- it crashes under the default Ruby encoding on German UTF-8 text;
- it works when invoked with explicit UTF-8 encoding;
- it only considers reachable pages;
- it only accepts IDs matching digits plus an optional single letter;
- it does not modify files;
- it does not rewrite links;
- it has no collision-safe two-phase rename;
- it has no preview UI beyond YAML;
- it has no tests;
- it reports the count of pages with outgoing links rather than all discovered pages, which is confusing.

The algorithm is worth porting or retaining, but the tool is unfinished.

---

# 18. Architectural strengths to protect

The following should be treated as product requirements during refactoring:

1. **Root-level static project**
   - no build required to play;
   - Go Live works immediately.

2. **Markdown pages as real files**
   - no database;
   - no opaque visual editor format.

3. **Accumulating transcript**
   - previous story remains visible;
   - chosen decisions remain part of the narrative.

4. **Graph coupled to gameplay**
   - route highlighting;
   - available destination interaction;
   - rewind/replay.

5. **Grouped graph**
   - story areas are visually meaningful.

6. **URL-based deterministic replay**
   - no backend;
   - reproducible randomness;
   - shareable sessions.

7. **Persistent JavaScript environment**
   - pages can define variables and reusable functions.

8. **Dynamic scripted interactions**
   - printed Markdown;
   - temporary async choices;
   - combat/dialogue systems.

9. **Conditional arbitrary content**
   - not only conditional page links.

10. **Local assets and fonts**
    - self-contained deployment.

11. **Low-friction development**
    - edit, save, browser refresh.

---

# 19. Correctness issues by priority

## Critical

1. Rewind does not clear the actual Proxy-backed story context.
2. `forceTurnToPage()` is missing, breaking programmatic navigation.
3. `Math.w6()` calls nonexistent `Math.rand()`.
4. Browser Back/Forward changes the hash without rebuilding the visible session.
5. Refreshing the initial page creates a new seed.
6. Scripted choice tokens are confused with page IDs in graph route history.
7. Page/runtime errors are misreported as missing files.
8. Condition errors are silently hidden.
9. Async story code has no explicit awaited page lifecycle.
10. Ordinary story choices are not keyboard-accessible.

## High

11. Absolute root paths prevent portable subdirectory deployment.
12. Multiple distinct choices to the same target collapse in the graph.
13. DOT metadata is insufficiently escaped.
14. The author graph cannot see unreachable files.
15. There is no static missing-link or JavaScript checker.
16. There is no story/session format version.
17. The Ruby tool fails by default on UTF-8.
18. The Ruby tool calculates but does not apply renumbering.
19. No automated tests protect runtime semantics.
20. Page parsing exists in multiple browser-specific forms.

## Medium

21. Debug mode is inferred from any URL port.
22. Split-pane resize uses the wrong right-pane percentage.
23. Pan and zoom are not persisted.
24. Graph dark mode is incomplete.
25. No passage wrapper IDs exist.
26. No reduced-motion integration.
27. Images lack a supported accessible authoring workflow.
28. TTF font assets are larger than necessary.
29. Production cache busting is always enabled.
30. README documentation is almost empty.

---

# 20. Recommended refactoring direction

Do not begin with a new syntax, TypeScript rewrite, extension, font downloader, or sandbox.

## Stage 0: Freeze the baseline

- place the current project in Git;
- tag the exact working version;
- keep the Odysseus story as the primary regression fixture;
- retain the screenshots as visual references.

## Stage 1: Write behavioural tests and fix critical bugs

First protect and repair:

- initial load;
- ordinary navigation;
- transcript accumulation;
- selected/dismissed choices;
- variables and functions;
- conditions;
- expressions;
- deterministic randomness;
- reload replay;
- temporary scripted choices;
- graph path highlighting;
- graph rewind;
- terminal restart.

Then fix:

- Proxy context reset;
- programmatic navigation;
- dice helper;
- error classification;
- Back/Forward;
- initial seed replay;
- keyboard choices;
- split-pane resize.

## Stage 2: Extract modules without changing behaviour

A possible structure:

```text
src/
├── config.js
├── page-parser.js
├── story-context.js
├── session.js
├── runtime.js
├── transcript.js
├── graph-model.js
├── graph-view.js
├── pan-zoom.js
└── debug-view.js
```

JavaScript with JSDoc and `// @ts-check` is sufficient initially.

TypeScript can be introduced module by module after tests exist.

## Stage 3: Create reusable authoring analysis

Extract a parser usable outside the browser for:

- all-page discovery;
- missing links;
- unreachable pages;
- graph metadata;
- page JavaScript syntax checks;
- image checks;
- source locations.

This becomes the foundation for both:

- a CLI;
- the VS Code extension.

## Stage 4: Add extension features incrementally

First extension milestone:

- persistent story graph;
- diagnostics;
- click node to open Markdown;
- click edge to reveal source;
- create page;
- preview and apply renumbering;
- Git checkpoint before destructive operations.

The extension should not replace the existing browser runtime.

## Stage 5: Consider syntax cleanup only after compatibility tests

The current syntax has rough edges, but it is expressive.

A cleaner syntax can be introduced later with:

- a migration tool;
- explicit runtime semantics;
- support for old stories during transition.

---

# 21. Final conclusion

The current project already has the right product.

Its central ideas are stronger than the rewrite:

- the transcript feels like a story unfolding;
- the graph is meaningfully connected to play;
- state and randomness are reproducible;
- JavaScript can create real systems rather than only toggle links;
- the entire project remains static and transparent.

What it lacks is not a new foundation. It lacks:

- modularity;
- tests;
- diagnostics;
- authoring tooling;
- robust error handling;
- a few important correctness fixes.

The next step should be to define a small regression suite around the existing Odysseus story and repair the critical runtime bugs one by one without changing the visible experience.