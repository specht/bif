# BIF story syntax

This reference assumes you completed the quick start in [README.md](README.md).

## 1. Pages and the starting page

The configured story folder contains playable `.md` files directly inside it. A filename without `.md` is its page ID: `2.md` has ID `2`. BIF always starts at `1.md`. Page IDs are case-sensitive and should not contain `/`.

Subdirectories hold assets, not playable pages. Notes that are not story pages belong outside the configured story folder. `bif-assets/` is reserved for generated BIF files such as locally cached story fonts.

## 2. Story appearance, headings, and Markdown

The optional front matter at the top of `1.md` contains story-wide settings. It is not repeated on other pages.

```markdown
---
theme: paper
accent: "#7a432b"
background: "#f7f0e2"
text: "#342c23"
font_body: Literata
font_heading: DM Serif Display
---

# Night train
```

Available themes are `default`, `paper`, `mystery`, `midnight`, `terminal`, and `playful`. Every theme provides its own default body and heading fonts and a preferred brightness. `default` follows the system; `paper` and `playful` prefer light; `mystery`, `midnight`, and `terminal` prefer dark. Set `brightness: light`, `brightness: dark`, or `brightness: system` to override the theme. `system` follows the reader's operating-system/browser preference. Override either font by entering an exact family name from [Google Fonts](https://fonts.google.com/). BIF authoring downloads non-bundled fonts into the story's generated `bif-assets/` directory so the playable story uses local font files. The `bif-assets/` name is reserved for BIF.

The supported front-matter settings are:

- `title`: optional title override
- `theme`: reader theme
- `brightness`: optional `light`, `dark`, or `system` override
- `accent`: optional six-digit hex accent color such as `#ff7a18`
- `background`: optional six-digit hex background color such as `#18141a`
- `text`: optional six-digit hex text color such as `#ffb347`
- `font_body`: body and choice font
- `font_heading`: heading font

`accent` changes links and related reader highlights. `background` replaces the theme's base background, and `text` replaces the theme's normal foreground and heading color. BIF derives surfaces, borders, and muted colors from the resulting background/text pair. If `background` is given without `text`, BIF chooses a high-contrast text color automatically. If both custom colors are present but have less than 4.5:1 contrast, authoring reports a warning while preserving the colors exactly as written.

Write ordinary Markdown after the front matter. The title comes from `title` metadata or the first H1 in `1.md`:

```markdown
# Night train

Rain stripes the compartment window.
```

Headings, lists, emphasis, quotations, and inline HTML are supported.

In story prose, type ordinary straight quotation marks. BIF renders them with German typography:

```markdown
> "Die Tür ist abgeschlossen."
```

renders as `„Die Tür ist abgeschlossen.“`. Single straight quotes are rendered as `‚…‘`. Code spans and script contents are not typographically changed.

## 3. Page choices

An internal link whose target is a page ID becomes a choice:

```markdown
- [Open the door](2)
- [Wait quietly](3)
```

Write `(2)`, not `(2.md)`. External URLs and links containing a path remain ordinary links.

Choice attributes can add a graph label or condition:

```markdown
- [Use the brass key](4){label="Key route" condition="has_key"}
```

## 4. Story-local images and media

Relative asset paths start at the configured story folder, regardless of which page contains them:

```markdown
![A brass key](images/key.jpg)

<audio controls src="audio/door.mp3"></audio>
<video controls><source src="video/train.webm" type="video/webm"></video>
```

For `pages-night-train/1.md`, `images/key.jpg` means `pages-night-train/images/key.jpg`. Put every story-specific asset inside that story folder. Relative traversal outside it is an authoring error. A leading `/` is an intentional site-root escape; `http:`, `https:`, protocol-relative, `data:`, fragment-only, and other explicit URI schemes are left unchanged.

## 5. Graph metadata and groups

An opening HTML comment can name a graph group and optionally provide a compact node summary:

```markdown
<!-- Station -- Waiting beneath the clock -->

# The platform
```

The first part groups related pages. The second part is the graph label. Metadata affects authoring display, not navigation.

## 6. Local choices and result blocks

Target `.` to change the current page without navigating:

```markdown
- [Search the drawer](.)
  The drawer contains a folded map.
```

Result content belongs directly under its choice. A local choice must contain visible result content or a result script. Do not nest another story choice inside a result; place follow-up choices at top level and reveal them with a condition.

## 7. Variables, expressions, and conditions

Story scripts share a session context:

```html
<script>
coins = 3;
has_key = true;
</script>
```

Print a value with double brackets:

```markdown
You carry [[ coins ]] coins.
```

Conditionally include an element:

```html
<p condition="has_key">The key feels warm.</p>
```

Expressions and conditions are JavaScript expressions. The authoring analyzer checks their syntax before play.

## 8. Scripts and helpers

Inline, non-module `<script>` blocks may use these helpers:

- `print(markdown)` appends rendered Markdown.
- `presentChoice(choices)` presents computed choices and resolves to the selected value.
- `goToPage(pageId)` performs programmatic navigation.
- `Math.chance(percent)` returns a probability result.
- `Math.w6()` rolls an integer from 1 through 6.

Example:

```html
<script>
const answer = await presentChoice([
  ['left', 'Take the left tunnel'],
  ['right', 'Take the right tunnel'],
]);
print(`You chose **${answer}**.`);
await goToPage(answer === 'left' ? '7' : '8');
</script>
```

Await asynchronous helpers. External and module scripts are rejected so analysis and replay remain predictable.

## 9. Navigation and sessions

BIF stores one compressed, explicitly versioned JSON session in the URL hash. It records the random seed and story events so reload and browser history can replay the same session. Malformed or unsupported hashes safely start a new session. Restart clears story history and state.

The local `?mode=dev` and `?mode=game` query values select and remember a view only on a development URL with a port. They do not activate authoring on an ordinary hosted domain.

## 10. Diagnostics and constraints

Run `npm run check` for a one-time report. Keep `npm run dev` running, or enable **BIF Authoring Tools**, for live graph and Problems updates.

Diagnostics cover at least missing `1.md`, missing or ambiguous targets, unreachable pages, invalid config paths, missing story-local assets, asset traversal, missing image alternative text, unsupported scripts, invalid expressions and conditions, and invalid result nesting.

## 11. Compact example

`config.js`:

```js
export const path = "pages-key";
```

`pages-key/1.md`:

```markdown
# The brass key

![A brass key](images/key.jpg)

<script>has_key = false;</script>

- [Take the key](.)
  <script>has_key = true;</script>
  You pocket the key.

- [Open the gate](2){condition="has_key"}
```

`pages-key/2.md`:

```markdown
# Beyond the gate

You are free.
```
