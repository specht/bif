# BIF

BIF is a static, browser-based interactive-fiction system. Authors write numbered Markdown pages, connect them with choices, and use the local authoring view to inspect the complete story graph and its Problems list. Readers receive only the book-like game view.

## Quick start

Install the tools once:

```bash
npm install
```

Then either enable the **BIF Authoring Tools** VS Code extension or keep the shared analyzer running:

```bash
npm run dev
```

Open `index.html` with Live Server. A URL with a development port opens the authoring view on first use. Use **Open game view** and **Open authoring view** to switch; BIF remembers the choice for this project path. An ordinary hosted domain always opens the game and never loads authoring controls.

## Project structure

```text
index.html
config.js
runtime/                 player, fonts, icons, and browser libraries
dev/                     authoring UI and Graphviz
pages-my-story/
├── 1.md
├── 2.md
└── images/
    └── key.jpg
tools/                   shared Node analyzer and publisher
.story-tools/
└── analysis.json        generated authoring data
```

`index.html`, `config.js`, and story folders stay at the repository top level. `runtime/` is required by readers. `dev/` is loaded dynamically only in a local authoring environment.

## Create or select a story

`config.js` has one setting:

```js
export const path = "pages-my-story";
```

The folder must remain inside the project. Every story begins at `1.md`; its title comes from title metadata or the first H1 on that page.

The smallest story is:

```markdown
# The locked room

The door opens.
```

Add another page with a choice:

```markdown
- [Walk into the garden](2)
```

## Graph and Problems

The browser authoring graph has one source: the Node analyzer publishes `.story-tools/analysis.json`, and the authoring UI reads it. The extension and `npm run dev` call the same publication service. The player does not crawl pages or build a second graph.

The Problems tab reports missing pages and assets, unreachable pages, malformed expressions, script errors, and authoring constraints. Fix errors rather than weakening the checks.

If analysis is missing or invalid, enable **BIF Authoring Tools** or run `npm run dev`, then choose **Retry**. If story inputs no longer match the hashes recorded in the publication, the last valid graph remains visible but is clearly marked out of date.

## Commands

```bash
npm run dev       # publish once, then watch the selected story
npm run check     # analyze once; fail when the story has errors
npm test          # main test suite
npm run test:all  # main suite plus extension tests
```

Use `npm run check -- --strict` when warnings should also fail the command.

## Static deployment

BIF needs no build step and works below any URL prefix. Upload exactly this minimum game bundle:

```text
index.html
config.js
runtime/
pages-my-story/
```

Keep the same relative layout. The story folder includes all of its own images and media. `dev/`, `tools/`, `package.json`, and `.story-tools/analysis.json` are not needed for a production game deployment. Production renders no authoring toggle or analysis status.

A local authoring checkout additionally contains:

```text
dev/
tools/
package.json
vscode-extension/        optional
.story-tools/analysis.json
```

## VS Code extension

**BIF Authoring Tools** discovers BIF projects, watches `config.js` and the selected story folder, publishes the same deterministic analysis used by `npm run dev`, and exposes diagnostics, refresh, summary, and output commands. It does not generate a separate HTML artifact.

See [SYNTAX.md](SYNTAX.md) for the complete authoring language.
