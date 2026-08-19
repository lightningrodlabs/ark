# Standing brief for `ark` implementation tasks

Read this first. A dispatch adds only a short task-specific block on top of it;
everything here applies every time.

## The project

`ark` is a Moss tool (Holochain 0.7 / Moss 0.16) that archives text for a
community — meeting minutes, filed in an amendable folder tree, searchable
across the whole corpus. It replaces a Drupal site holding 1406 records,
2001–2026, thirteen committees, 25 attached files.

Design rules that constrain almost every change:

- **Nothing is ever destroyed.** No `delete_entry` anywhere. Trash is a
  removable link; folder deletion is a `deleted` tombstone; filings and
  attachments are link add/remove.
- **Links target a document's original create action, never a version**, so
  amending never disturbs filing or attachments.
- **The whole corpus lives in UI memory** — that is what makes client-side
  search possible without a server.
- **Anyone in the group may amend anything.** Group membership is the trust
  boundary, so every reader is reachable by every writer: all rendered markdown
  goes through `renderMarkdown` (DOMPurify), and nothing else may produce HTML
  for `{@html}`.

## Environment

Run **every** command with the Bash sandbox disabled
(`dangerouslyDisableSandbox: true`). The sandbox profile alone exceeds the exec
argument limit here, so every command fails with `E2BIG` regardless of length.
This is not optional and it is not a sign anything is wrong.

Commands:

| what | command | notes |
|---|---|---|
| unit tests | `npm run test -w ui` | fast |
| typecheck | `npm run typecheck -w ui` | must stay 0 errors, 0 warnings |
| e2e | `npm run test:e2e -w ui` | headless Chromium, ~6s, no display needed |
| DNA | `nix develop -c npm test` | minutes; only if you touch Rust |
| the app | `nix develop -c npm run applet-dev-1` | needs a display — **you do not have one** |

There is **no display server**. You cannot see the app. Playwright headless is
your substitute and it is a good one — use it rather than reasoning about what
the UI probably does.

## Constraints

- Do not bump `@sveltejs/vite-plugin-svelte` (`^4.0.4`), `vite` (`^5.4.0`), or
  `@theweave/api` (`0.7.0-dev.1`).
- All DNA calls go through `ArkClient`; file storage through `FileStorageClient`.
- Reactive stores are `.svelte.ts` (Svelte 5 runes only compile there); pure
  logic modules stay plain `.ts` so they are unit-testable.
- The view layer never reaches into `search.index` directly — `SearchStore` has
  pass-throughs.
- Production code must never import from `ui/harness/`.
- Nothing from `~/code/the reference corpus/` may enter this repo, verbatim or
  redacted. Fixtures are invented content reproducing real markup shapes.

## Things that do not work inside Moss

The applet runs in a sandboxed Electron iframe. Learned the hard way, each one
after shipping a broken button:

- **`window.prompt` is not implemented by Electron** — returns null, so handlers
  silently do nothing. Use inline input UI instead (see `FolderNode.svelte`).
- **`window.open` is always denied.** Moss's `setWindowOpenHandler` returns
  `{ action: 'deny' }` for everything except `http(s)://`, which it hands to the
  OS browser. `blob:` URLs therefore go nowhere.
- **`$state` values are Proxies** and cannot be structured-cloned across the
  iframe bridge. `ArkClient.call` strips them via `toPlain`; do not bypass it.
- `confirm` and `alert` **do** work.

If you need a browser capability, check it against this list first, and add to
the list anything new you discover.

## How to work

1. **Reproduce before fixing.** Write the failing spec or test first and watch
   it fail. A fix without a demonstrated failure is a guess, and several
   "obvious" diagnoses in this project have been wrong.
2. Fix the cause, not the symptom. If the same bug class exists elsewhere, say
   so rather than silently fixing beyond your brief.
3. Keep the suites green: unit, typecheck, and e2e.
4. Commit in logical commits with messages that explain *why*.

## Escalate rather than work around

Report `BLOCKED` or `NEEDS_CONTEXT` with what you tried. In particular:

- If an API in your brief does not exist as described, report what it actually
  offers. Do not substitute something that merely compiles.
- If a test in your brief encodes behaviour the code cannot produce, show the
  actual output rather than adjusting the test.
- If a dependency version conflicts, report it — pins are the controller's call.
- If a fix needs restructuring rather than a local change, describe the shape
  you think it needs and stop.

Pushing back has been right more often than not in this project. Several
implementers found real defects in the brief itself; that is expected, not a
failure.

## Report

Write a full report to the path given in your dispatch, covering what you
changed, evidence for each fix (the failing run, then the passing one), test
output for every suite you ran, and anything you could not verify.

Then reply with **only** (under 15 lines):

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits (short SHA + subject)
- Test summary: unit / typecheck / e2e
- Concerns, if any
- The report file path
