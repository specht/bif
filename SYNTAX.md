# BIF story syntax

This is the reference for the authoring format implemented by BIF. Start with the minimal example, then use the later sections when you need state or scripting.

## 1. Minimal story

A project needs the player files, `config.js`, and a selected page directory:

```text
story/
├── config.js
└── pages/
    ├── 1.md
    └── 2.md
```

```js
// config.js
export const path = 'pages';
```

```markdown
<!-- pages/1.md -->
# My story

- [Begin.](2)
```

```markdown
<!-- pages/2.md -->
# The end

You made it.
```

`config.js` is mandatory. The selected directory's `1.md` is always the start page.

## 2. Page files and page IDs

Each Markdown filename without `.md` is its page ID. Link to `8.md` as `(8)`, not `(8.md)`. IDs are case-sensitive, but IDs that differ only by case are diagnosed because they are unsafe across filesystems. A target must be a simple internal ID without `/`; normal external URLs remain ordinary links. Assets use browser paths such as `images/map.jpg`.

The exact target `.` is local: it stays in the current transcript page instance. `./`, `self`, `here`, `#`, and a link back to the current numeric ID are not aliases. A link from `12.md` to `(12)` creates a new visit to page 12.

## 3. Story title

Only `1.md` supplies story metadata. A narrow opening front matter block wins:

```markdown
---
title: "City: of Thieves"
---
```

Otherwise the first real level-one heading is used. With neither, BIF uses `Untitled story` and reports a warning. Title front matter is removed from rendered content; an H1 remains visible.

## 4. Markdown and HTML

BIF uses markdown-it with ordinary paragraphs, headings, emphasis, strong text, quotations, lists, code, images, and links. Raw HTML is enabled and is trusted author content. Use local images with useful alternative text:

```markdown
![A brass key on red velvet](images/key.jpg)
```

The analyzer reports missing local assets, unsafe paths, and missing image alt text. Browser support determines the exact behavior of raw HTML.

## 5. Choices

A story choice is an internal Markdown link, conventionally in a list:

```markdown
- [Walk to the Dining Car.](8)
- [Take the quiet route.](8) { condition="knows_route" label="quiet" }
```

`condition` controls availability. `label` supplies an authoring-graph label. Parallel choices to the same page remain distinct. A selected page choice stays in the accumulated transcript while its alternatives become inactive. Links to external sites are ordinary links, not story choices.

## 6. Choice result blocks

A choice may own a nested result block. Write a blank line after the choice and indent every result line by four spaces:

```markdown
- [Ask Adler whether he travels often.](.)

    > “Every Thursday,” he says.
```

The result is absent before selection. It may contain the same Markdown, HTML, conditions, expressions, images, and inline scripts as a page fragment. BIF processes it in source order.

Use `.` for a local choice. It commits the selected option and its result as a new chronological turn, reevaluates the live choice set, and neither fetches nor appends the page. Page-entry scripts do not run again.

```markdown
- [Ask about the suitcase.](.)

    <script>
    knows_suitcase_went_forward = true;
    </script>

    > “A porter carried it toward the front.”

- [Ask what the porter looked like.](.) { condition="knows_suitcase_went_forward" }

    > “Grey coat. Red gloves.”
```

A page choice processes its result before entering its target:

```markdown
- [Give Mara the key.](18)

    <script>
    has_key = false;
    mara_has_key = true;
    </script>

    You place the key in Mara's hand.
```

Script-only results are valid. A result needs no author variable merely to remain visible. Completed answers are frozen transcript history; expressions in them do not change later.

Indentation associates a result block with its choice in the source; it does not fix the result at that source position in the transcript. When a local choice is selected, the old live choice buttons disappear. The selected option remains as a non-clickable, button-shaped committed choice, its result appears immediately below it, and one newly evaluated live choice set appears at the end of the page instance. Source order controls each live choice set; selection order controls committed transcript chronology.

All currently available story choices are collected into that single live choice set at the end of the active page, even when choices and prose are interleaved in the source. After a successful local turn, BIF scrolls the story transcript only as far as needed to reveal the committed answer and the new choices. A long answer is anchored near its beginning instead of being skipped. Reload and rewind restore immediately without replaying scroll animations, and reduced-motion preferences disable smooth scrolling.

Before selection:

```text
[Ask about the route]
[Ask about the suitcase]
```

After selecting the suitcase question:

```text
[Ask about the suitcase — committed]
The suitcase went toward the front.
[Ask about the route]
[Ask what the man looked like]
```

Local completion is scoped to one page instance. Returning to the same page creates a fresh instance, while meaningful story variables persist. Internal story choices cannot be nested inside results; put follow-ups at top level and reveal them with a condition. Ordinary nested lists and external links are allowed.

## 7. Variables and persistent story state

Scripts assign directly to persistent names:

```html
<script>
visits = (visits ?? 0) + 1;
has_key = true;
suspect_name = 'Adler';
</script>
```

Values are shared by later scripts, conditions, and expressions and appear in the development State inspector (functions are omitted there). Initialize names before reading them, or use `??` as above. Use clear JavaScript identifiers for story facts. BIF tracks local-choice completion internally; do not create bookkeeping flags just to reveal an answer.

## 8. Scripts

An inline `<script>` at page level is a page-entry script. One inside a result block is a result script. Both use the same persistent context and execute in source order. Result scripts run only when their choice is selected and run before a page-choice target is entered.

Scripts may use `await`; BIF awaits the operation and prevents overlapping choice transactions. Syntax or runtime failure stops the operation, discards staged DOM, and restores state. A failed page choice also discards its result if the target cannot load or execute. Completed earlier pages remain intact. External `src` and module scripts are not a supported authoring form; keep code inline. Story JavaScript is trusted author code, not a security sandbox.

## 9. Conditions

Conditions are JavaScript expressions. They work on choices and raw HTML elements, including result content:

```markdown
- [Use the key.](4) { condition="has_key && trust >= 2" }

<div condition="coins > 0">
You hear coins in your pocket.
</div>
```

Useful operators include `===`, `!==`, `<`, `<=`, `>`, `>=`, `&&`, `||`, and `!`. A false condition quietly omits that content. Once a local choice is committed, its question and result remain visible even if its original condition later becomes false.

## 10. Expressions

Insert a value as text with either form:

```markdown
There are [[ticket_count]] tickets left.

<span expression="suspect_name"></span>
```

Expressions are JavaScript expressions evaluated against story state. Their values are inserted as text, not interpreted as HTML. In a result, an expression sees changes made by preceding result scripts.

## 11. Dynamic output and advanced APIs

Scripts can use:

```js
print('Rendered **Markdown**');
const answer = await presentChoice([['yes', 'Say yes'], ['no', 'Say no']]);
await goToPage('8');
```

`print` appends rendered Markdown. `presentChoice` is the advanced API for temporary or computed choices that static Markdown cannot express; it returns the selected first tuple value. `goToPage` performs normal programmatic navigation. `forceTurnToPage` is a legacy alias. Await asynchronous helpers. `Math.chance(percent)` returns a probability result and `Math.w6()` rolls 1–6. Random results replay deterministically within saved sessions.

## 12. Groups

An opening HTML comment gives authoring-graph metadata:

```markdown
<!-- Train -- Dining car -->
# Dinner
```

The first field is the group; the optional second field is the short graph summary. Groups organize the graph and do not change gameplay.

## 13. History, replay, and rewind

The transcript accumulates completed page instances. BIF stores a compressed, versioned session in the URL with its random seed, route choices, dynamic-choice events, and local selections. Reload and browser Back/Forward replay each page and result script once. Graph rewind reconstructs the selected checkpoint; Restart clears the route, local results, and story state. Old route-only URLs remain readable.

Choice identities come from stable source position and ordering. Authors do not write them. Editing choice layout can invalidate an old saved selection; BIF skips an unknown selection rather than activating a different choice.

Newly committed page content is visually revealed in semantic chunks. Short prose appears whole; longer plain prose may use sentence groups, while headings, quotations, images, lists, tables, code, HTML blocks, and live choice sets remain intact. Choices appear last. Readers can click or tap the story area, or press Space, Enter, or Escape, to reveal everything immediately. Reduced-motion and replayed history are immediate. This is presentation only: scripts and story state finish before reveal begins, and no author syntax is required.

## 14. Diagnostics and analyzer rules

Run:

```bash
npm run check-story
npm run analysis
npm run story-graph
```

The analyzer checks missing and ambiguous targets, reachability, scripts, conditions, expressions, local assets, image alt text, and result source lines. Local `.` choices are counted and analyzed but create no graph node, edge, self-loop, or missing-target diagnostic. Choices to real pages create edges, and distinct choices to the same page remain distinct parallel edges. An empty local choice produces a warning because it has no visible effect. A nested internal choice in a result is an error. Public diagnostics use the Markdown page line; parser-local coordinates remain structured implementation detail.

## 15. Complete examples

The examples above cover branching, conditions, local conversation and state, page transitions with results, groups, and scripted choices. Rich result content is ordinary Markdown:

```markdown
- [Ask for a description.](.)

    <script>
    knows_description = true;
    </script>

    > “Grey coat. Red gloves.”

    ![Adler's sketch](images/sketch.jpg)

    - grey coat
    - red gloves

    <div condition="knows_gloves_are_rare">You have seen these gloves before.</div>
```

## 16. Syntax quick reference

```markdown
- [Page choice](2)
- [Conditional choice](2) { condition="ready" label="route" }
- [Local choice](.)

    Result Markdown.

[[expression]]
<span expression="count + 1"></span>
<div condition="ready">Conditional content.</div>
<script>ready = true;</script>
<!-- Group -- Graph summary -->
```

## 17. Known limitations

- Results cannot contain internal BIF choices; use top-level conditional follow-ups.
- Result ownership follows CommonMark list nesting. The documented blank line and four spaces avoid ambiguous indentation.
- Raw HTML is trusted and browser-dependent.
- External and module scripts are not supported story syntax.
- Source edits that move choices may make an old saved local-selection event unknown.
- `presentChoice` is intentionally lower-level than static choice results and does not use their nested Markdown model.
