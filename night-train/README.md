# Der Nachtzug — BIF starter story

This ZIP contains an original, complete BIF story in German.

## Install

1. Copy `pages-night-train/` into the root of your BIF project.
2. Change `config.js` to:

```js
export const path = 'pages-night-train';
```

3. Start the project through Live Server.
4. Run the analyzer:

```bash
npm run check-story
npm run story-graph
```

The story starts at `pages-night-train/1.md`.

## What this starter demonstrates

- train cars as graph groups;
- reusable car hub pages;
- passengers whose locations change by story phase;
- local dialogue choices with indented result blocks;
- page choices with scripts;
- persistent knowledge, trust, inventory and evidence;
- chance through `Math.chance(...)`;
- parallel choices to the same page;
- multiple investigations and endings;
- replayable state and conditional follow-up questions.

## Files for authors

- `AUTHOR-NOTES.md` explains the real sequence of events, characters and state model.
- `WALKTHROUGH.md` gives one route to a strong ending.
- `STORY-MAP.md` lists the pages and groups.

The story deliberately contains places where you can add passengers, clues, train cars, conversations and endings.
