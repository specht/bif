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

The initial Playwright suite checks that the configured story renders without
page errors, navigation appends to the transcript while preserving the chosen
choice and URL history, and graph rewind removes story variables from an
abandoned route. The rewind scenario uses a small story under
`test-fixtures/rewind-state/`.

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
