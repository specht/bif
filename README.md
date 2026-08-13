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
# Nach Schulschluss

Du willst gerade gehen, da fällt dir ein: Deine Projektmappe liegt noch im Materialschrank.
```

Add another page and link to it with a choice:

```markdown
- [Öffne die Tür](2)
```

Then create `2.md` in the same story folder.


## Themes, colors, and fonts

Story-wide appearance belongs in the front matter at the top of `1.md`. It is optional; a story without front matter keeps the default BIF appearance.

```markdown
---
theme: mystery
accent: "#d91e36"
background: "#18141a"
font_body: Libre Baskerville
font_heading: Special Elite
---

# Nach Schulschluss

Du willst gerade gehen ...
```

Built-in themes are `default`, `paper`, `mystery`, `midnight`, `terminal`, and `playful`. Each theme already has a matching heading/body font pair and a preferred brightness, so `theme:` can be used by itself. `font_body:` and `font_heading:` override either font independently.

| Theme | Body | Headings | Brightness |
| --- | --- | --- | --- |
| `default` | IBM Plex Sans | IBM Plex Sans | system |
| `paper` | Literata | DM Serif Display | light |
| `mystery` | Libre Baskerville | Special Elite | dark |
| `midnight` | Inter | Space Grotesk | dark |
| `terminal` | IBM Plex Mono | IBM Plex Mono | dark |
| `playful` | Nunito | Fredoka | light |

Override the theme's preferred brightness when needed:

```markdown
---
theme: terminal
brightness: system
---
```

`brightness:` accepts `light`, `dark`, or `system`. `system` follows the reader's operating-system/browser preference.

Students can also tweak a theme without defining all of its colors themselves:

```markdown
---
theme: midnight
accent: "#ff7a18"
background: "#18141a"
---
```

`accent:` changes links, focus highlights, and choice accents. `background:` changes the reader's base background; BIF automatically derives readable text, surfaces, and borders from it. Both settings accept six-digit hex colors (`#RRGGBB`). If `background:` is present, its actual lightness determines the readable foreground palette even if the selected theme normally prefers another brightness.

To choose another typeface, browse [Google Fonts](https://fonts.google.com/), copy the family name exactly, and put it in `font_body:` or `font_heading:`. While `npm run dev` is running, BIF downloads the required font files into the selected story's generated `bif-assets/` directory and rewrites the Google Fonts stylesheet to use those local files. Readers of the published story therefore do not need to contact Google Fonts.

`bif-assets/` is reserved for BIF-generated story files. Do not put your own images, audio, or other assets there.

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
