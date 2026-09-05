# ui-probe — the screens, rendered

`node scripts/ui-probe/run.mjs` bundles `ui-probe.jsx` with the esbuild that ships inside Vite, drops it in a
jsdom window whose `fetch` is answered from the fixture inside each case, and asserts the text a person would
read on screen. No Postgres, no Redis, no browser.

It exists because a review round said *"the button is there"* and the interesting question was never whether the
JSX contains a `<button>` — it is whether the button appears for the role that is allowed to press it, and
whether the screen says something true when the API answers `[]`, `500`, or a 401. Two of the cases have
already paid for themselves: they caught a row action calling its `show(row)` predicate with no row, and an
early `return <NoAccess/>` that sat above two hooks (React's "rendered more hooks than the previous render").

`jsdom` is not a project dependency — install it once with `npm install --no-save jsdom` (frontend/node_modules
works too, the runner looks there second). Anything the probe cannot see — real SQL, real SMTP, real print
styles — is out of scope and stays documented in `docs/14-built-and-not-built.md`.

The cases run from `CASES` in `ui-probe.jsx`; add one per complaint, keep the assertion sentence about *what
the user sees*, not about implementation.
