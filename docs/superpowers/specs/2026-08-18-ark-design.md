# ark — design

Date: 2026-08-18
Status: approved, ready for implementation planning

## What this is

`ark` is a Moss tool for archiving text. A community files documents — meeting
minutes, reports, decisions — into a folder structure, amends them when they
need correcting, and searches the whole archive.

It replaces what Drupal did for the reference corpus: 1406 meeting records across
13 committees, 2001–2026, 784,754 words, 5.1 MB of text, with 25 attached files.
That corpus is the reference workload for every performance decision here.

The tool is not a collaborative editor. Documents are written elsewhere — Google
Docs, mostly — and pasted in. There is no concurrent co-editing (see
`../notebooks` for the tool that does that).

## Constraints

Fixed by the requester:

- Holochain 0.7, Moss 0.16 (dev builds acceptable)
- Attachments via `holochain-open-dev/file-storage`
- Svelte UI, matching the other tools in this workspace
- Standard repo layout, per `../presence-0.7` and `../emergence`
- CI and red-green testing are mandatory
- The UI must accept paste from Google Docs; DHT storage format is a free choice
- No live co-editing, but signals broadcast to known peers (from the Moss weave
  API) on structure changes and document additions/deletions
- Search must be good. The full text of every document is expected to fit in UI
  memory, and that is acceptable.

## Design decisions

Each of these was chosen deliberately; the rejected alternative is recorded so a
later reader knows it was considered.

**Documents are immutable; amendments form a version chain.** Normal Holochain.
The latest version displays, earlier ones stay visible beneath it with author
and timestamp.

**Anyone in the group may amend any document.** Moss group membership is the
trust boundary. Every version is attributed and nothing is destroyed, so a bad
amendment is visible and correctable by anyone else. Rejected: author-only
(breaks when the author leaves the community), and an author-plus-stewards role
system (a permissions surface the MVP does not need).

**A mutable folder tree, one updatable entry.** Folders have stable ids;
documents attach to folder ids by link. Renaming, re-parenting and reordering
touch only the tree entry, and moving a document touches no entry at all.
Rejected: one entry per folder (no merge logic needed, but several round trips
to load a structure of a dozen folders), and pure `hash_path` anchors (a rename
would rewrite every link beneath it, which is exactly the operation that must
stay cheap).

**Bodies are markdown.** Pasted HTML is converted at the UI edge. Small,
diffable between versions, indexable as-is, and the same format the existing
reference corpus export already produced, so import is a straight copy. Rejected: sanitized
HTML canonical (higher paste fidelity, at the cost of a sanitizer on the write
path, an HTML-aware differ and a strip-tags pass for search), and HTML plus a
derived plaintext field (redundant field that can drift, bodies roughly double).

**Document metadata is an open string map the DNA does not interpret.** The MVP
uses `title` and `date`. Validation checks no keys, so a newer UI can add fields
with no DNA change, and an older UI displays unknown keys as plain labelled rows
rather than dropping them. Rejected: a DNA-stored amendable schema entry
(powerful, but needs a schema editor and migration thinking), and typed metadata
values (better sorting, still hardcodes the key set).

**Folder membership is links, not a field on the document.** Moving a document
between folders creates no new version and does not appear in its history.

**Nothing is ever destroyed.** Three reversible tombstone mechanisms, each the
cheap one for its shape: a `deleted` flag inside the tree entry for folders, a
trash link for documents, link add/remove for filing and attachments. No
`delete_entry` anywhere in the MVP.

## Repository layout

```
ark/
  dnas/ark/
    zomes/integrity/{ark,file_storage}/
    zomes/coordinator/{ark,file_storage}/
    workdir/dna.yaml
  ui/                    svelte 5, vite, typescript
  tests/                 tryorama + vitest
  workdir/               happ.yaml, web-happ.yaml
  docs/superpowers/specs/
  weave.dev.config.ts
  flake.nix, Cargo.toml
  .github/workflows/test.yaml
```

Structure follows `../presence-0.7`. The `file_storage` integrity and coordinator
zomes are vendored into the DNA the way `../emergence` does it.

## DNA

### Entries

```rust
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Document {
    pub body: String,                     // markdown
    pub meta: BTreeMap<String, String>,   // "title", "date"; open set
}

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct FolderTree {
    pub folders: Vec<Folder>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Folder {
    pub id: String,              // stable, never reused
    pub name: String,
    pub parent: Option<String>,  // None = top level
    pub order: u32,
    pub deleted: bool,           // tombstone, see below
}
```

Both entry types are public and updatable.

### Validation

Deliberately minimal:

- `Document` updates carry no author check — anyone may amend.
- `meta` keys are not checked against any schema. Keys must be non-empty.
- Size bounds: `body` at most 1 MiB, serialized `meta` at most 8 KiB. The largest
  reference corpus body is about 10 KB, so neither is a practical constraint; they guard
  against a base64 image being pasted into a body instead of attached, and keep
  every document well inside Holochain's 4 MB entry limit.
- `Folder.id` values within one `FolderTree` must be unique.

### Links

| Link type | Base | Target | Purpose |
|---|---|---|---|
| `AllTrees` | `Path("tree")` | tree create action | discover the tree; multiple roots merge |
| `AllDocuments` | `Path("docs")` | doc create action | load-everything path for the search index; the backstop that makes every document reachable |
| `FolderToDocument` | `Path("folder:{id}")` | doc create action | filing; tag carries `date` for cheap ordering |
| `TrashedDocuments` | `Path("trash")` | doc create action | soft delete |
| `DocumentToFile` | doc create action | file `EntryHash` | attachments |

Every link targets a document's **original create action**, never a version. So
amending a document never drops its filing or its attachments.

### Resolving latest

Two helpers over the same update graph, because documents and the tree want
opposite things from a fork.

**Documents want one winner.** `latest_of` walks the graph from the original and,
where it branches, keeps the head with the newest action timestamp, ties broken by
action hash so every peer picks the same one. That yields the version to display,
and a companion walk collects the losing branches so every version — not only the
winning path — appears in the history beneath it.

**The tree wants them all.** `all_tips` returns every leaf of the graph. Collapsing
the tree to a single winner would discard the losing branch's folders outright,
which would make both the union merge and the `deleted` tombstone pointless: a
concurrent "add a folder" on the losing side would simply vanish. The zome never
merges; it hands every tip to the UI, which merges them (below).

### Tree merge

The tree is one entry that anyone may update, so concurrent edits fork the update
chain. Rather than lock it, the UI resolves forks deterministically:

1. Collect every head across every root linked from `Path("tree")`.
2. Union all `folders` by `id`.
3. Where an `id` appears in several heads, keep the one from the newest action;
   ties broken by action hash.
4. Commit the merged result onto **every** current tip on the next write, so all
   tips carry identical content and the fork stops mattering. Writing only the
   newest tip would leave the loser's tip live forever, growing the tip count with
   every concurrent edit.

Every peer computes the same tree from the same data. Concurrent renames of the
*same* folder resolve last-writer-wins, which at the scale of a dozen committees
is the right trade.

Concurrent "add a folder" never loses a folder — but that takes one piece of
merging in the zome, not just the client-side union. A caller sends a full folder
list, and that list can be stale through no fault of its own: another agent may
have added a folder between the caller's read and its write. Writing the list
verbatim would erase it. So `update_folder_tree` carries forward any folder id the
caller did not send. Ids the caller *did* send always win, so renames,
re-parenting and `deleted` tombstones still take effect, and deletion is
unaffected because it is a tombstone the caller sends rather than an omission.

That is the only merging the zome does. Reconciling forked heads stays the UI's
job, because only it can apply the newest-action-wins rule across heads.

**Folder deletion must be a tombstone, not removal.** Union-by-id takes folders
from all heads, so a folder removed from the vec would be resurrected by any
concurrent head that still carries it. Setting `deleted: true` makes deletion a
field change that merges under the same rule as a rename. It also keeps the
folder `id` known, so links under `Path("folder:{id}")` stay enumerable and no
document becomes unreachable.

A tombstone may be dropped from the vec on a later write once no links remain
beneath it.

### Document trash

Trashing is `create_link` from `Path("trash")`. The document's folder link is
left in place, so the trash view can say which folder it came from and restore is
a single `delete_link` that puts it back exactly where it was. Two agents
trashing the same document creates two links; restore removes all of them, so
there is no merge question.

A trashed document stays in `AllDocuments` and stays readable at its hash. Its
version history travels with it as one unit, because trash attaches to the
document identity.

`delete_entry` is not used. It is irreversible, which is wrong for an archive, and
it would leave a record present-but-dead that the UI has to special-case anyway.
A real purge is deferred; see "Out of scope".

### Orphan detection

Entirely client-side, from data the UI already holds.

The UI loads every document from `AllDocuments` for the search index, and loads
`get_links` for every folder id in the merged tree **including tombstoned ones**.
Two set differences fall out:

- **In deleted folders** — documents whose only folder link points at a
  tombstoned id. Shown as a bin per deleted folder, labelled with its former
  name, so they can be re-filed in bulk.
- **Unfiled** — documents in `AllDocuments` with no folder link at all. Catches
  never-filed documents and the edge case of a stale link pointing at an id no
  tree head knows about.

Neither costs a DHT round trip beyond the folder `get_links` the UI already does.
A trashed document whose folder was also deleted appears in trash only, so
nothing is listed twice.

When the UI deletes a folder it offers to move the documents inside to the parent
folder first, deleting an empty folder in the common case. The orphan bin is the
safety net for when someone deletes anyway, and for tombstoned subtrees.

### Coordinator API

```
create_document(body, meta, folder_id: Option<String>) -> Record
amend_document(original_action_hash, body, meta)       -> Record
get_document_versions(original_action_hash)            -> Vec<Record>
get_all_documents(offset, limit)                       -> Vec<Record>   // latest of each
move_document(original, from_folder, to_folder)        -> ()
trash_document(original)                               -> ()
restore_document(original)                             -> ()
get_trashed()                                          -> Vec<ActionHash>
get_folder_documents(folder_id)                        -> Vec<ActionHash>
get_folder_tree()                                      -> Vec<Record>   // all heads, UI merges
update_folder_tree(folders)                            -> Record
attach_file(original, entry_hash)                      -> ()
detach_file(original, entry_hash)                      -> ()
get_attachments(original)                              -> Vec<EntryHash>
notify_peers(peers, signal)                            -> ()
```

`notify_peers` takes the peer list from the caller. The UI supplies it from the
Moss weave API rather than the DNA maintaining its own roster.

### Signals

One payload enum, each variant carrying only the hashes the receiver needs to
patch its store and index incrementally:

```
DocumentCreated  { original }
DocumentAmended  { original, new_version }
DocumentTrashed  { original }
DocumentRestored { original }
DocumentMoved    { original, from: Option<String>, to: Option<String> }
TreeUpdated      { action }
```

Remote signals are best-effort. The UI also reconciles cheaply — `get_links` on
`AllDocuments` and `AllTrees`, diffed against what it holds — on window focus and
on a timer, so a missed signal costs staleness until the tab is looked at, not a
stuck view.

## UI

### Stack

Svelte 5 + TypeScript + Vite, Shoelace for widgets. The lit-based
`@holochain-open-dev/{profiles,file-storage,elements}` and
`@theweave/{api,elements}` packages mount as custom elements — the interop
`../emergence` already uses — so authorship avatars and file upload/preview are
not rebuilt.

```
ui/src/
  ark-client.ts        typed zome wrapper; all calls in one place
  stores/              documents, tree (merge lives here), search, signals, weave
  search/              index build, query parser, snippets
  paste/               html→markdown, google-docs cleanup
  import/              front-matter parse, batch import, dry run
  lib/                 FolderTree, DocumentList, DocumentView, DocumentEditor,
                       VersionHistory, SearchBar, SearchResults, Trash, OrphanBin,
                       ImportPanel, Attachments
```

Each pure module — tree merge, version resolution, query parser, snippet
generator, paste conversion, front-matter parsing — lives outside components so
it is unit-testable without a conductor.

### Loading

`get_all_documents` in chunks of about 100, latest version of each, streamed into
the store so the tree and search become usable while the rest arrives. At reference corpus
scale that is 1406 records, roughly 5 MB, over the local websocket.

No IndexedDB cache in the MVP. The performance test below measures cold load at
1406 documents; if it is fast enough, the cache is complexity nobody needed. If
it is not, it slots in behind the same store interface, keyed on immutable action
hashes.

### Search

MiniSearch over every body in memory, updated incrementally as signals arrive.

- **Ranked results with snippets.** Fields `title` (boost 4), `body` (1),
  `attachment_text` (0.5). MiniSearch ranks. The keyword-in-context snippet is
  ours: about 120 characters either side of the first matched term, with every
  matched term marked.
- **Phrase, boolean, prefix.** A small query parser in front of MiniSearch, which
  provides prefix, fuzzy and AND/OR but not quoted phrases or negation. The
  parser handles `"exact phrase"`, `-term` and `NOT`, `OR`, and defaults to AND;
  the term set goes to MiniSearch and candidates are post-filtered for phrase
  adjacency and negation. Pure function, own unit tests.
- **Filters.** Folder (including descendants, resolved against the merged tree),
  `meta.date` range, and author. Combinable with a text query or usable alone, so
  "everything in Buildings and Land, 2019–2022" works with no query.
- **Text attachments.** `.md`, `.txt` and `.csv` attachments are fetched, indexed
  under their parent document, and a hit reports which attachment matched. Binary
  attachments are listed but not indexed.
- Trashed documents are excluded by default, with an "include trashed" toggle.

### Writing and paste

The editor is a markdown textarea with live preview, not a WYSIWYG — the tool
archives text edited elsewhere.

The paste handler reads the `text/html` clipboard flavor and converts before
insertion: unwrap the `docs-internal-guid` span, map Google Docs' inline-CSS
weight and style spans to `**` and `*` (43% of the reference corpus corpus looks like this),
keep tables via GFM, drop the rest. Plain-text and markdown pastes pass through
untouched. What lands in the textarea is markdown the author can see and correct
before committing.

Amending opens the same editor pre-filled with the current version. `DocumentView`
shows the latest version with a version strip beneath it — author, timestamp, and
a diff against the previous version.

### Import

`ImportPanel` accepts a directory or zip of `.md` files with YAML front matter.

- `committee` → folder, created if absent
- `meeting_date` → `meta.date`
- `title` → `meta.title`
- source id preserved as `meta.import_id`, e.g. `drupal:1802`
- files named in `attachments` front matter are uploaded through file-storage and
  linked

Import is idempotent: the importer builds the set of `import_id` values already
present and skips matches, so a partial import resumes rather than duplicates. It
runs a dry run first — N new, M already present, K folders to create, all listed
— and writes only on confirm.

## Testing

Red-green throughout. Every step of the implementation plan names its failing
test first and is sized to one test-then-code cycle.

### UI unit tests (vitest)

- tree union-merge: concurrent adds keep both; concurrent renames of one folder
  resolve identically on every peer; a tombstone beats a stale head that still
  carries the folder
- latest-version resolution and version ordering across a branched update graph
- query parser: quoted phrases, `-term` and `NOT`, `OR`, prefix, and combinations
- snippet generation and term marking
- Google-Docs HTML → markdown, fixture-driven. `the reference corpus/minutes/html/`
  holds 1406 real files covering the span-soup case, the plain-text-with-raw-`<p>`
  case and tables; a handful of representative files are copied in as fixtures
  rather than inventing HTML
- front-matter parsing and import idempotency (re-running an import writes
  nothing)

### Tryorama integration tests (`tests/`, vitest + `@holochain-open-dev/tryorama`, 2–3 agents)

- amend by a different agent than the author; both agents converge on the same
  latest version
- concurrent amends from two agents resolve to an identical latest on both
- move between folders creates no new version and leaves history untouched
- concurrent tree edits from two agents union-merge with no folder lost
- folder tombstone survives a concurrent rename from another agent
- trash and restore, including two agents trashing the same document
- documents under a tombstoned folder are discoverable as orphans
- attachments survive an amendment
- a signal emitted by one agent lands on the other

### Performance test

Index build time and query latency at 1406 documents, against budgets: build
under a few seconds, query under 100 ms. This answers the "do we need a cache"
question with a number.

The reference corpus corpus is a community's real minutes and does not belong in a public
repo. The fixture is **generated** — synthetic text matching the real corpus in
document count, body-length distribution and folder spread — with
`ARK_CORPUS_DIR` to point the same test at the real corpus locally when the true
number is wanted.

## CI

`.github/workflows/test.yaml`, modeled on presence-0.7's: nix flake with holonix
0.7, cargo and npm caches, then build wasm zomes → `hc app pack` → tryorama tests
→ UI unit tests → `svelte-check` typecheck → lint. One job; the wasm build
dominates and splitting costs more than it saves.

## Dev setup

`flake.nix` from presence-0.7 (Holochain 0.7). No `rust-toolchain.toml` — presence-0.7
has none, and holonix `main-0.7`'s `rust` package supplies the wasm target and the
compiler the Holochain 0.7 dependency tree expects.
`@theweave/cli 0.16.0-dev.x` with a `weave.dev.config.ts` running two agents for
`npm run applet-dev`, plus `hc-spin` for non-Moss iteration.

Repository lives at `~/code/metacurrency/holochain/ark`. The existing empty
`minutes/` directory is left untouched.

## Out of scope for the MVP

Recorded so they are not re-litigated mid-implementation, and so a later reader
knows they were considered rather than missed:

- **Purge.** A real `delete_entry` plus link cleanup, for genuinely unwanted
  content. Deferred; trash covers the ordinary case reversibly.
- **IndexedDB cache.** Measured: `ui/src/search/perf.test.ts` builds the
  `ArkIndex` over a synthetic 1406-document corpus (matching the reference
  workload's document count, and within about 2% of its total word count)
  in ~250-300 ms against a 5000 ms budget, and answers each of five
  representative queries in under 15 ms against a 100 ms budget — both
  roughly an order of magnitude inside budget. Run locally against the real
  reference corpus archive (1409 documents) the build takes ~550 ms, still comfortably
  inside budget. No cache is needed for the MVP; cold load at this scale is
  not a problem worth the added complexity.
- **Roles and permissions.** Anyone in the group may do anything.
- **A DNA-stored metadata schema entry.** Metadata stays an open map the UI
  interprets.
- **Documents filed in more than one folder.** One parent per document.
- **Tags.** The folder tree is the only classification in the MVP.
- **Live co-editing.** Explicitly not this tool.
- **Indexing binary attachments.** PDFs and spreadsheets are listed, not
  searched.
- **Playwright end-to-end tests.** vitest and tryorama cover the MVP.
