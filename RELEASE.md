# Releasing Ark

Ark is distributed as a `.webhapp` referenced by the
[weave-tool-curation](https://github.com/lightningrodlabs/weave-tool-curation)
list. A release is **UI-only**. It bundles the current UI with the *exact same*
frozen happ as every previous release on the same line. So all installs stay on
the same DNA and network, and existing users keep their data.

## Lines and networks

| Line | Holochain | Tags | How the happ was built |
|---|---|---|---|
| 0.1.x | 0.6 | `ark-v0.1.*-hc0.6` (branch `main-0.6`) | CI, `release-happ.yaml` |
| 0.1.x | 0.7.0 | `ark-v0.1.*-hc0.7` | CI, `release-happ.yaml` |
| 0.2.x | 0.7.1 | `v0.2.*`, happ `happ-v0.2.0` | locally, frozen (this document) |

DNA version 0.2.0 (Holochain 0.7.1, file-storage 0.701.0) is a new network.
Holochain 0.7.1 changed the capability-grant format, so these zomes cannot start
on a 0.7.0 conductor, and 0.7.0 and 0.7.1 conductors cannot gossip. The 0.2.x
line cannot see any document written on 0.1.x, so a group has to upgrade
together. It needs Moss 0.16.0-rc.1 or later.

To carry an archive over, open **About → Export…** on the 0.1.x install. It
writes each document that is not in the trash to one zip, as markdown with YAML
front matter. Unzip it. On the 0.2.x install, use **About → Import… → Choose a
folder** and pick the unzipped folder. Only the current version of each document
moves over. The export records how many earlier versions there were. The
importing agent becomes the author of everything it imports.

## The CI happ build is retired

Up to 0.1.2 the happ was rebuilt in CI by `.github/workflows/release-happ.yaml`
on every release. That workflow is now **deleted**. From 0.2.0 on the happ is
built once, locally, frozen as a GitHub release, and only the UI is built in CI.

## Why the happ is frozen (never rebuilt)

The zome wasm embeds the builder's absolute paths (`~/.cargo/...` and source
paths via the HDK macros). That makes the happ **non-reproducible** on a
different machine/user or in CI. A rebuild produces a different DNA hash, and
so a different network. The happ is built once and those exact bytes are reused
forever.

The canonical bytes live as the `happ-v<dnaVersion>` GitHub release. The tag is
in `.happ-version`. Their sha256 is in `.happ-sha256`. Both
`scripts/release-happ.sh` and the release workflow check it.

> ⚠️ Do **not** release by uploading the output of `npm run package`. That
> rebuilds the happ locally with plain `build:happ`, which skips wasm-opt
> (different bytes → wrong DNA → a forked network).
> Releases must go through the tag-triggered workflow below.

## One-time per DNA version: publish the canonical happ

```bash
rm -rf target/wasm32-unknown-unknown   # wasm-opt edits target/ in place; start clean
nix develop --command bash -c "npm run build:happ:release"
nix develop --command bash scripts/release-happ.sh
```

`build:happ:release` is the canonical build. Before it packs, it runs
`scripts/wasm-opt-zomes.mjs` (`wasm-opt -Oz --strip-debug --strip-producers`)
over each zome in `dnas/ark/workdir/dna.yaml`. Plain `build:happ` skips that
step. So it gives a **different DNA hash**, which is a different network. That
is intentional: dev builds must never join the canonical network. Publish only
the output of `build:happ:release`.

The script verifies `workdir/ark.happ` against `.happ-sha256` and
creates/updates the `happ-v<dnaVersion>` release. It also accepts the URL of an
already-published `.webhapp` as its first argument, to recover the exact bytes of
a line that is already live.

This must be done **before the first 0.2.x webhapp release**. If the local build
does not match `.happ-sha256` (a different machine, a `cargo clean`, a dependency
bump), the script refuses and tells you what to do: that mismatch is the tripwire
that stops a silent network fork. Deliberately starting a new DNA line means
bumping `dnaVersion` in `ui/package.json`, updating `.happ-version`, and writing
the new sha into `.happ-sha256`.

## Each release: cut a webhapp

1. Bump `version` in `ui/package.json` (must be higher than the installed
   version for Moss to offer it as an upgrade). The Holochain 0.7.1 line
   starts at `0.2.0` on curation versionBranch `0.2.x`.
2. Commit, then:

   ```bash
   npm run release:webhapp        # tags v<version> and pushes
   ```

3. The [`release-webhapp`](.github/workflows/release-webhapp.yaml) workflow then:
   - downloads the frozen happ from `happ-v<dnaVersion>` and checks its sha256
     against `.happ-sha256`,
   - builds the UI and packs `ark.webhapp` (no `--recursive`, so the happ
     is embedded verbatim — never rebuilt),
   - re-verifies the embedded happ still equals the frozen DNA,
   - prints the three curation hashes to the run summary,
   - publishes a **prerelease** GitHub release named `v<version>` with
     `ark.webhapp` attached. It is deliberately not a draft: draft assets are
     not served at the public `releases/download/<tag>/...` URL Moss fetches,
     so they 404.
4. Nothing is live yet — updating the curation list below is the go-live gate.

## Update the curation list

The workflow run summary (and the release body) contains:

```json
"hashes": {
  "happSha256": "<frozen>",         // always the frozen DNA, from .happ-sha256
  "webhappSha256": "<new>",
  "uiSha256": "<new>"
}
```

Add a new `versions[]` entry for `ark` in the 0.16 curation list with the
new `version`, the release's `ark.webhapp` `url`, and these hashes. Because
`happSha256` is unchanged, Moss treats it as an in-place upgrade on the same
network. To get the hashes for an artifact locally: `npm run weave-hash`.

The changelog for 0.2.0 must say: new Holochain 0.7.1 network; needs Moss
0.16.0-rc.1 or later; cannot see documents from 0.1.x; groups upgrade together;
carry an archive over with About → Export… on the old install and Import… on
the new one.
