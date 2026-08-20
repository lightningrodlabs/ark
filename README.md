# Ark

An archive for a community's written record.

Minutes, decisions and reports accumulate for decades, and they usually end up
in something one person administers: a Drupal site, a shared drive, a wiki with
a password nobody can find. Ark keeps that record on Holochain instead, so it
lives in the group rather than on a server, and every member holds it.

Documents are immutable, as they are everywhere in Holochain, but they are not
frozen: amending one publishes a new version and keeps the old, so the record
shows what it says now and what it used to say. The folder tree is separate
from the documents, held as links, which means reorganising the archive never
touches a document. Anyone in the group can file, amend, and reorganise.

Search runs entirely in the browser over the whole corpus — ranked results with
snippets, quoted phrases, prefix terms, exclusions, and the text of attachments
alongside the documents themselves.

Ark is a [Moss](https://theweave.social) tool.

## Which line is this?

This is the `main-0.6` branch: **Holochain 0.6** (`hdi 0.7`, `hdk 0.6`,
holonix `main-0.6`) and **Moss 0.15** (`@theweave/cli 0.15.x`,
`@theweave/api 0.6.x`). The `main` branch is the parallel Holochain 0.7 /
Moss 0.16 line. The two are kept in step; pick the branch that matches the
conductor and Moss you are running.

## Development model

This is the **maintenance line**. Work is authored on `main` (Holochain 0.7 /
Moss 0.16) and back-ported here by cherry-pick — not the other way round. The
exception is a change that applies only to this line, such as the HDK pin
matching the conductor Moss 0.15 bundles; those are authored here and never
carried forward.

## Environment Setup

> PREREQUISITE: set up the [holochain development environment](https://developer.holochain.org/docs/install/).

Enter the nix shell in the root folder of the repository:

```bash
nix develop
npm install
```

**Run the rest of these commands from inside that nix shell**, or they won't
work.

## Running it in Moss

Two agents, each in their own Moss window, sharing a group:

```bash
npm run start:moss
```

One agent, for when a second one is just in the way:

```bash
npm run start:moss-1
```

Three, for watching structure changes propagate:

```bash
npm run start:moss-3
```

## Running it without Moss

```bash
npm start
```

This brings up a network of two conductors and their UIs.

## Tests

The DNA tests run against a real conductor and take a few minutes:

```bash
npm test
```

The UI's own tests are much faster and need no conductor:

```bash
npm run verify         # unit tests and typecheck
npm run test:e2e -w ui # end-to-end, headless, no display required
```

The end-to-end suite drives the real UI against an in-memory conductor stub, so
it covers the parts that only break in a browser — the file picker, the search
overlay, attachment previews, the pane header — without needing Holochain
running.

## Building

```bash
npm run package
```

Produces `workdir/ark.webhapp`.

## Importing an existing archive

Ark reads a directory of markdown files with YAML front matter. `title`,
`date`, `folder` and `attachments` are understood; every other key is carried
through and kept, because what counts as metadata is a decision for the
community holding the archive, not for this tool.

Export is the same format in reverse — a zip of markdown and attachments laid
out in folders mirroring the tree. What Ark writes out, Ark reads back in.

## License

[![License: CAL 1.0](https://img.shields.io/badge/License-CAL%201.0-blue.svg)](https://github.com/holochain/cryptographic-autonomy-license)

Copyright (C) 2026, Lightningrod Labs

This program is free software: you can redistribute it and/or modify it under
the terms of the license provided in the LICENSE file (CAL-1.0). This program
is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
