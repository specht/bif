# BIF

BIF is a static, browser-based system for branched interactive fiction. Stories are written as numbered Markdown pages and connected with choices.

The repository is intentionally arranged so that story authors only need to care about a few files. The implementation lives in `engine/`.

## Quick start

Install the tools once:

```bash
npm install
```

Then either enable the **BIF Authoring Tools** VS Code extension or run:

```bash
npm run dev
```

Open `index.html` with Live Server. In a local authoring environment you can switch between the story and graph views. On an ordinary hosted domain only the story player is shown.

## Project structure

```text
config.js                 select the story folder
index.html                open this with Live Server
pages-starter/
└── 1.md                  your story starts here

engine/                   BIF implementation; normally leave this alone
README.md
SYNTAX.md
package.json
package-lock.json
```

`.bif-project` marks the folder as a BIF project for the authoring extension. Generated analysis is written to `.story-tools/` and is ignored by Git.

## Create or select a story

`config.js` contains one setting:

```js
export const path = "pages-starter";
```

Every story begins at `1.md`. The title comes from title metadata or the first H1 on that page.

The starter deliberately contains only one page:

```markdown
# Meine Geschichte

Hier beginnt deine Geschichte.
```

Add another page and link to it with a choice:

```markdown
- [Öffne die Tür](2)
```

Then create `2.md` in the same story folder.

## Graph and Problems

The local authoring graph is generated from the selected story. The Problems view reports missing pages and assets, unreachable pages, malformed expressions, script errors, and other authoring problems.

The VS Code extension and `npm run dev` use the same analyzer and publish `.story-tools/analysis.json`. Story files themselves remain plain Markdown.

## Commands

```bash
npm run dev       # publish analysis and watch the selected story
npm run check     # analyze the selected story once
npm test          # run the engine test suite
```

Use `npm run check -- --strict` when warnings should also fail the command.

## Static deployment

BIF needs no build step. A playable story only needs:

```text
index.html
config.js
engine/runtime/
pages-your-story/
```

Keep the same relative layout. The story folder contains its own images and other media. The rest of `engine/`, the npm files, and `.story-tools/` are authoring/development files and are not needed by readers.

See [SYNTAX.md](SYNTAX.md) for the complete authoring language.
