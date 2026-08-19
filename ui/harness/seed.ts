import type { ActionHash, EntryHash } from '@holochain/client';
import type { StubAppClient } from './stub-client';

/** Thirteen committees, as the Drupal archive being replaced has. */
export const COMMITTEES = 13;
/** 1406 records, 2001–2026 — the real corpus size. */
export const TOTAL_DOCUMENTS = 1406;
/** The largest single committee, the worst case for one expanded node. */
export const BIGGEST_COMMITTEE = 280;

const call = (client: StubAppClient, fn_name: string, payload: unknown) =>
  client.callZome({ role_name: 'ark', zome_name: 'ark', fn_name, payload });

/**
 * Fill a stub client with an archive the shape of the real one.
 *
 * Content is invented — nothing from the source archive may enter this repo —
 * but the SHAPE is what matters here: how many folders, how many documents,
 * and how lopsidedly they are distributed, since one committee holding 280
 * documents is what an expanded tree node has to cope with.
 */
export async function seedReferenceArchive(client: StubAppClient): Promise<void> {
  const folders = Array.from({ length: COMMITTEES }, (_, i) => ({
    id: `committee-${i}`,
    name: `Committee ${i + 1}`,
    parent: null,
    order: i,
    deleted: false,
  }));
  await call(client, 'update_folder_tree', { folders });

  const rest = Math.floor((TOTAL_DOCUMENTS - BIGGEST_COMMITTEE) / (COMMITTEES - 1));
  let made = 0;
  for (let f = 0; f < COMMITTEES && made < TOTAL_DOCUMENTS; f++) {
    const want = f === 0 ? BIGGEST_COMMITTEE : rest;
    for (let d = 0; d < want && made < TOTAL_DOCUMENTS; d++, made++) {
      const year = 2001 + (made % 25);
      const month = String(1 + (made % 12)).padStart(2, '0');
      const day = String(1 + (made % 28)).padStart(2, '0');
      await call(client, 'create_document', {
        body: `Minutes of the meeting. The treasurer presented the budget of $${made} and it was approved.`,
        meta: { title: `Minutes of ${year}-${month}-${day}`, date: `${year}-${month}-${day}` },
        folder_id: folders[f].id,
      });
    }
  }
  // Anything left over from the integer division goes in the last committee,
  // so the total is exact rather than approximately right.
  while (made < TOTAL_DOCUMENTS) {
    await call(client, 'create_document', {
      body: 'Minutes of an additional meeting.',
      meta: { title: `Additional minutes ${made}`, date: '2026-01-01' },
      folder_id: folders[COMMITTEES - 1].id,
    });
    made++;
  }
}

/**
 * A folder with two filed documents, for the "node has documents but not the
 * folder structure" load-phase scenario. Callers pair this with
 * `client.simulateStructurePending()` (see stub-client.ts) so the DNA state
 * exists — folders and filing links — while `get_folder_tree` still reports
 * `root_count: 1, heads: []`, exactly what a peer sees when a root link has
 * gossiped in ahead of its `FolderTree` entry.
 */
export const PENDING_STRUCTURE_FOLDER = 'Finance Committee';
export const PENDING_STRUCTURE_DOCS = ['January minutes', 'February minutes'];

export async function seedPendingStructureArchive(client: StubAppClient): Promise<void> {
  const folderId = 'finance-committee';
  await call(client, 'update_folder_tree', {
    folders: [{ id: folderId, name: PENDING_STRUCTURE_FOLDER, parent: null, order: 0, deleted: false }],
  });
  for (const [i, title] of PENDING_STRUCTURE_DOCS.entries()) {
    await call(client, 'create_document', {
      body: `Minutes of the ${title} meeting. The treasurer presented the budget and it was approved.`,
      meta: { title, date: `2026-0${i + 1}-15` },
      folder_id: folderId,
    });
  }
}

/** Fixed title/body the asset-view specs assert against. */
export const ASSET_DOCUMENT_TITLE = 'Board Minutes';
export const ASSET_DOCUMENT_BODY_TEXT = 'The treasurer presented the budget and it was approved.';

/**
 * One document, created directly against the stub (not through the UI), for
 * the Moss asset-view seam in harness-main.ts. Its hash is what
 * `__ARK_TEST_ASSET__` names as the document to render — see
 * `App.svelte`'s onMount, which reads `assetWal.hrl[1]` from it exactly as
 * it would read `weaveClient.renderInfo.view.wal.hrl[1]` inside real Moss.
 */
export async function seedAssetDocument(client: StubAppClient): Promise<ActionHash> {
  return (await call(client, 'create_document', {
    // Deliberately no leading `# ` heading: `meta.title` already renders as
    // the page's <h2>, and a markdown title here would duplicate it as an
    // <h1> — exactly the kind of accidental double-heading a real minutes
    // document would not have either.
    body: ASSET_DOCUMENT_BODY_TEXT,
    meta: { title: ASSET_DOCUMENT_TITLE, date: '2026-01-15' },
    folder_id: null,
  })) as ActionHash;
}

/** Fixed name/content the asset-view attachment specs assert against. */
export const ASSET_TEXT_ATTACHMENT_NAME = 'agenda.txt';
export const ASSET_TEXT_ATTACHMENT_CONTENT = 'Item 1: Call to order.\nItem 2: Approve minutes.';
export const ASSET_IMAGE_ATTACHMENT_NAME = 'photo.png';
// A 1x1 PNG — the smallest thing that still proves the bytes round-tripped
// through file storage, the blob URL, and the decoder (see
// attachments.spec.ts's image-preview regression test, which this mirrors).
const ASSET_IMAGE_ATTACHMENT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Upload one small file straight against the stub's file_storage handlers
 * (`create_file_chunk` / `create_file_metadata`), mirroring the payload
 * shapes `FileStorageClient.uploadFile` sends for a single-chunk file (see
 * stub-client.ts's comments on those two handlers) rather than constructing
 * a real `FileStorageClient`. This file is statically imported by *.spec.ts,
 * which Playwright runs under Node, not a browser — a value import of
 * `@holochain-open-dev/file-storage` pulls in its `dropzone` dependency,
 * which references the browser global `self` at module load time and
 * crashes every spec with "self is not defined" before a single test runs.
 * `harness-main.ts` (browser-bundled) is the only place that may import that
 * package as a value.
 */
async function uploadStubFile(
  client: StubAppClient,
  name: string,
  file_type: string,
  bytes: Uint8Array,
): Promise<EntryHash> {
  const chunks_hashes = [await call(client, 'create_file_chunk', bytes)];
  return (await call(client, 'create_file_metadata', {
    name,
    size: bytes.length,
    file_type,
    last_modified: Date.now(),
    chunks_hashes,
  })) as EntryHash;
}

/**
 * The asset document (see `seedAssetDocument`) plus one attachment. Returns
 * the document's `original` action hash, same as `seedAssetDocument`.
 */
async function seedAssetDocumentWithAttachment(
  client: StubAppClient,
  name: string,
  file_type: string,
  bytes: Uint8Array,
): Promise<ActionHash> {
  const original = await seedAssetDocument(client);
  const file_hash = await uploadStubFile(client, name, file_type, bytes);
  await call(client, 'attach_file', { original, file_hash });
  return original;
}

export function seedAssetDocumentWithTextAttachment(client: StubAppClient): Promise<ActionHash> {
  return seedAssetDocumentWithAttachment(
    client,
    ASSET_TEXT_ATTACHMENT_NAME,
    'text/plain',
    new TextEncoder().encode(ASSET_TEXT_ATTACHMENT_CONTENT),
  );
}

export function seedAssetDocumentWithImageAttachment(client: StubAppClient): Promise<ActionHash> {
  const bytes = Uint8Array.from(atob(ASSET_IMAGE_ATTACHMENT_BASE64), (c) => c.charCodeAt(0));
  return seedAssetDocumentWithAttachment(client, ASSET_IMAGE_ATTACHMENT_NAME, 'image/png', bytes);
}

/** The asset document, amended once — two versions, for VersionHistory. */
export async function seedAssetDocumentWithVersions(client: StubAppClient): Promise<ActionHash> {
  const original = await seedAssetDocument(client);
  await call(client, 'amend_document', {
    original,
    body: `${ASSET_DOCUMENT_BODY_TEXT} Amended after the treasurer's follow-up.`,
    meta: { title: ASSET_DOCUMENT_TITLE, date: '2026-01-16' },
  });
  return original;
}
