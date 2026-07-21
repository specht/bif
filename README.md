Flags
-----

- can set flag on page
- can test flags later to show/hide content and options

- this enables:
  - inventory system
  - quest system
  - achievements
  - companion system

Probability
-----------

- can show content based on probability with else branch

Running and testing
-------------------

Open the repository-root `index.html` with the VS Code Live Server extension to
play the story without a build step.

Install the browser-test dependencies once with `npm install`, then run the
regression suite with `npm test`. To watch the tests in a browser, use
`npm run test:headed`.

In development mode, the graph pane reads the optional generated snapshot
`.story-tools/analysis.json`. One compact graph shows the complete authored
topology—including unreachable pages, missing targets, groups, and parallel
choices—while the running player overlays the current page, visited route,
available choices, and rewind checkpoints. There is no separate graph mode.
Summary counters and a docked, collapsible **Problems (N) | State** inspector
expose analyzer diagnostics and runtime state without covering the graph or
changing the story session.

The BIF VS Code extension generates the snapshot after analysis. Without the
extension, run `npm run analysis -- --watch` while editing. After loading or
returning to a visible tab, the browser makes bounded quick checks (250, 250,
500, 500, and 1000 milliseconds), then monitors about every four seconds. This
handles the race where Live Server reloads before publication finishes while
still catching later updates that cause no reload. Checks pause in hidden tabs.
There is no permanent Refresh control; an unhealthy analysis notice offers a
contextual **Retry** action. If analysis is unavailable, the older recursive
play graph remains as a visibly limited fallback. Normal playback never
requests or polls the file, so static reader deployment remains independent of
analysis tooling and Node.js.

Browser behavior can be selected explicitly with `?mode=dev` or `?mode=game`.
Game mode always uses the published reader layout with no analysis traffic;
development mode forces the graph and inspector. With no recognized `mode`
value, the existing port/URL automatic detection remains in effect. The mode
stays in the URL query while story session history continues to use the hash.

The initial Playwright suite checks that the configured story renders without
page errors, navigation appends to the transcript while preserving the chosen
choice and URL history, and graph rewind removes story variables from an
abandoned route. The rewind scenario uses a small story under
`test-fixtures/rewind-state/`.

Checking a story
----------------

Run `npm run check-story` to analyze the story selected by `config.js` without
opening a browser or executing story JavaScript, conditions, or expressions.
The checker discovers all Markdown pages, validates internal links and
reachability, parses embedded scripts, conditions, and expressions as
JavaScript, and checks local image paths. It is the reusable foundation for
future editor tooling.

Use `node tools/check-story.js --project path/to/project` to check another
project, `--json` for deterministic machine-readable output, or `--strict` to
make warnings fail the command. JSON output uses schema version `1` and contains
the project configuration, summary counts, diagnostics, and the parsed page and
edge graph. The command exits nonzero when it finds an error; warnings alone
pass unless `--strict` is used. `npm test` runs both the fast analyzer tests and
the browser regression suite; the browser-only command is
`npm run test:browser`.

Publishing browser analysis
---------------------------

Run `npm run analysis` to analyze the current project and atomically publish the
versioned, non-executable snapshot `.story-tools/analysis.json`. To publish a
different BIF project, use:

```bash
npm run analysis -- --project /path/to/story
```

For extension-free continuous publication, use:

```bash
npm run analysis -- --watch
npm run analysis -- --project /path/to/story --watch
```

Watch mode publishes once immediately, then debounces relevant project changes.
It serializes analysis runs, ignores `.story-tools/`, dependencies, Git data,
and editor temporary files, and continues watching after a failed update so a
later save can recover.

Publication succeeds even when the story contains analyzer errors or warnings;
the command reports those counts in its output. Use `npm run check-story` when
diagnostics should determine CI success. The browser development graph and
summary read the generated JSON, and the BIF VS Code extension updates the same
file on saved-file analysis through the same shared Node service. No browser
needs to be open for publication.

In short, the three tooling commands have distinct jobs:

- `npm run check-story` validates a story for humans and CI;
- `npm run analysis` publishes machine-readable browser analysis;
- `npm run story-graph` exports the standalone authoring graph.

Everything under `.story-tools/` is local generated output. Do not deploy it
with the normal reader site.

Standalone authoring graph
--------------------------

Run `npm run story-graph` to generate `.story-tools/graph.html`. The generated
file is a self-contained offline authoring graph, separate from the graph used
while playing. It includes every discovered page, unreachable pages, explicit
missing-target nodes, parallel choices, metadata groups, and analyzer
diagnostics.

The graph supports search, status and group filters, pan and zoom controls, and
details for pages and individual choices. Source locations can be copied or
opened through `vscode://` links. A custom project and output file can be used
with:

```bash
node tools/story-graph.js \
  --project /path/to/story \
  --output /path/to/graph.html
```

The file is still generated when story errors are present, but the command
exits with status `1`. Warnings alone pass unless `--strict` is supplied.

Story script helpers
--------------------

Embedded page scripts can use these helpers:

```js
print(markdown)
await presentChoice(options)
await goToPage(pageId)
```

`print()` appends rendered Markdown to the transcript. `presentChoice()` returns
a Promise that resolves with the selected option, and `goToPage()` returns a
Promise that resolves after the destination has been appended through the same
story transition used by normal choices. Story scripts should `await` both
asynchronous helpers.

`forceTurnToPage()` remains available as a legacy compatibility alias for
existing stories; new story code should use `goToPage()`.

Session history
---------------

The complete story session is stored in the URL using the existing compressed
history payload. Reloading the page, or using browser Back and Forward,
reconstructs the transcript and story state without a build step. The stored
random seed preserves deterministic outcomes during restoration.

Browser history records settled, user-visible story checkpoints rather than
intermediate asynchronous steps. Existing story URLs remain compatible.

Story errors
------------

In development mode, story errors are shown with their Markdown page and source
context. Missing pages, script errors, condition errors, and expression errors
are reported separately; a valid false condition remains silent and simply
hides its content. Asynchronous page-script failures are tracked through the
same reporting path.

The browser console contains the structured error object and full developer
details. Outside development mode, readers see only a restrained story-error
message rather than an internal stack trace.

Keyboard interaction
--------------------

Ordinary story choices remain links: use Tab to focus them and Enter to follow
them. Temporary choices created by `presentChoice()` remain buttons and support
both Space and Enter. After keyboard navigation, focus moves to the newly
appended passage; mouse and touch navigation retain the existing scrolling and
focus behavior.

Keyboard focus is visibly indicated, rejected choices leave the tab order, and
the player respects the system reduced-motion preference.
