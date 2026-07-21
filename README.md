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
