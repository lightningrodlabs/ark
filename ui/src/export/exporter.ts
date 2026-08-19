import { encodeHashToBase64 } from '@holochain/client';
import { dump } from 'js-yaml';
import { strToU8, zipSync } from 'fflate';
import type { DocumentSummary, Folder, Meta } from '../types';
import { folderPath } from '../tree/paths';

/**
 * Export: the archive written back out as ordinary files.
 *
 * The point of this module is that nothing here is trapped in the tool. What
 * it writes is exactly what `src/import/` reads — YAML front matter plus a
 * markdown body, laid out in directories that mirror the folder tree, with
 * attachments beside the document that names them. Anything ark exports it can
 * import again, which is the property `exporter.test.ts` asserts end to end
 * rather than in pieces.
 *
 * Pure logic only: no store, no client, no DOM. The caller supplies the corpus
 * and two callbacks (attachment bytes, version count), so this runs unchanged
 * under Node in the unit tests.
 */

/** Where documents that are in no folder go. Underscored so it sorts apart. */
export const UNFILED_DIR = '_unfiled';

/** Documents serialized before the event loop is handed back, so the UI paints. */
const YIELD_EVERY = 25;

/** Longest file name we will write, in characters, extension included. */
const MAX_NAME = 120;

export interface ExportSource {
  /** The whole in-memory corpus. */
  documents: DocumentSummary[];
  /** Every folder, tombstones included — see pathOf. */
  folders: Folder[];
  /** Document key (base64 original) -> folder id, or null when filed nowhere. */
  filings: Map<string, string | null>;
  /** Document keys currently in the trash. */
  trashed: Set<string>;
}

export interface PlannedExport {
  doc: DocumentSummary;
  /** Directory the document is written into, "/"-joined, no trailing slash. */
  dir: string;
  /** Full path of the markdown file inside the zip. */
  path: string;
  /** The folder path recorded in front matter, or null when unfiled. */
  folder: string | null;
}

/**
 * Characters no common filesystem accepts in a name. Accents, quotes, dashes
 * and every other bit of unicode are LEFT ALONE deliberately: titles in this
 * archive carry them, and transliterating a title is a lossy rename that the
 * person looking for the file afterwards has to guess at.
 */
const ILLEGAL = /[\\/:*?"<>|]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

function sanitizeSegment(raw: string, extra?: RegExp): string {
  let name = raw.replace(CONTROL, ' ').replace(ILLEGAL, '-');
  if (extra) name = name.replace(extra, '-');
  name = name.replace(/\s+/g, ' ').trim();
  // A name that is only dots is a directory reference, not a file.
  name = name.replace(/^\.+$/, '').replace(/\.+$/, '');
  return name.trim();
}

function truncate(name: string, ext: string): string {
  const room = MAX_NAME - ext.length;
  return name.length > room ? name.slice(0, room).trim() : name;
}

/** `<title>.md`, sanitised, never empty. */
export function documentFileName(title: string): string {
  const base = truncate(sanitizeSegment(title), '.md');
  return `${base || 'untitled'}.md`;
}

/**
 * Attachment names get one extra restriction: no commas. Front matter lists
 * them, and the importer splits that list on commas — a comma in the name
 * would come back as two names that match nothing.
 */
export function attachmentFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = truncate(sanitizeSegment(dot > 0 ? name.slice(0, dot) : name, /,/g), ext);
  return `${stem || 'attachment'}${ext}`;
}

/** "Finance and Legal/2014", or null when the document is filed nowhere. */
function pathOf(folders: Folder[], id: string | null | undefined): string | null {
  if (!id) return null;
  // Deliberately resolved against every folder, tombstones included: a
  // document filed under a deleted folder is still filed, and dropping it into
  // _unfiled on the way out would lose where it lived.
  const chain = folderPath(folders, id);
  if (chain.length === 0) return null;
  return chain.map((f) => sanitizeSegment(f.name) || 'untitled').join('/');
}

/**
 * Decide where every exported document goes, disambiguating names WITHIN a
 * directory. Two meetings on the same date with the same title is a real case
 * in this corpus; without this the second silently overwrites the first inside
 * the zip and the export is quietly a document short.
 */
export function planExport(source: ExportSource): PlannedExport[] {
  const taken = new Map<string, Set<string>>();
  const planned: PlannedExport[] = [];

  for (const doc of source.documents) {
    const key = encodeHashToBase64(doc.original);
    if (source.trashed.has(key)) continue;

    const folder = pathOf(source.folders, source.filings.get(key));
    const dir = folder ?? UNFILED_DIR;
    const name = unique(taken, dir, documentFileName(doc.meta.title ?? ''));
    planned.push({ doc, dir, path: `${dir}/${name}`, folder });
  }
  return planned;
}

/** `name`, or `name (2)`, `name (3)`… if this directory already has it. */
function unique(taken: Map<string, Set<string>>, dir: string, name: string): string {
  let used = taken.get(dir);
  if (!used) {
    used = new Set();
    taken.set(dir, used);
  }
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * Front matter plus body, in exactly the shape `parseFrontMatter` reads back.
 *
 * Every value is force-quoted. Unquoted, YAML would reinterpret "2014-03-04"
 * as a date and "12" as a number on the way back in, and a metadata map that
 * is `Record<string, string>` on both sides would then not survive its own
 * round trip. Quoting costs a little prettiness and buys exactness.
 */
export function serializeDocument(meta: Meta, body: string): string {
  const yaml = dump(meta, { forceQuotes: true, quotingType: '"', lineWidth: -1, sortKeys: false });
  return `---\n${yaml}---\n${body}`;
}

export interface ArchiveResult {
  bytes: Uint8Array;
  /** Markdown files written. */
  documents: number;
  /** Attachment files written. */
  attachments: number;
  /** Per-document notes for anything that could not be included. */
  failed: string[];
}

export interface ArchiveDeps {
  /** Attachment bytes for one document. Omitted means "export text only". */
  attachmentsOf?: (doc: DocumentSummary) => Promise<{ name: string; bytes: Uint8Array }[]>;
  /**
   * Total number of versions a document has. Called ONLY for documents whose
   * `updated_at` differs from `created_at` — i.e. ones actually amended.
   * Asking per document would be 1406 extra round trips for an archive where
   * amendments are rare.
   */
  versionsOf?: (doc: DocumentSummary) => Promise<number>;
  onProgress?: (done: number, total: number) => void;
  /** Hands the event loop back so the UI can paint. */
  yieldTo?: () => Promise<void>;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Build the whole zip.
 *
 * Compression is `zipSync`, not fflate's worker-backed async form: a Moss
 * applet runs in a sandboxed Electron iframe, and a Worker built from a blob
 * URL is exactly the kind of thing that environment refuses (see
 * docs/dev/fix-brief-template.md on `window.open` and `blob:`). One
 * synchronous compress at the end is predictable; a Worker that silently never
 * starts is not. The long part — serializing documents and fetching attachment
 * bytes — yields between batches so the progress the caller shows can paint.
 */
export async function buildArchive(
  source: ExportSource,
  deps: ArchiveDeps = {},
): Promise<ArchiveResult> {
  const planned = planExport(source);
  const files: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  const yieldTo = deps.yieldTo ?? tick;
  const takenAttachments = new Map<string, Set<string>>();
  let attachments = 0;

  for (let i = 0; i < planned.length; i++) {
    const { doc, dir, path, folder } = planned[i];
    const meta: Meta = { ...doc.meta };
    if (folder) meta.folder = folder;

    let names: string[] = [];
    if (deps.attachmentsOf) {
      try {
        for (const file of await deps.attachmentsOf(doc)) {
          // Attachments share a directory with every other document filed in
          // the same folder, and generic names recur across an archive — two
          // meetings can each ship an `agenda.pdf`. Disambiguate here, and
          // record the name actually written so front matter and file agree.
          const name = unique(takenAttachments, dir, attachmentFileName(file.name));
          files[`${dir}/${name}`] = file.bytes;
          names.push(name);
          attachments++;
        }
      } catch (e) {
        // An unreadable attachment must not cost the document itself: the text
        // is the archive, the attachment is beside it.
        failed.push(`${doc.meta.title || '(untitled)'}: attachments (${e})`);
        names = [];
      }
    }
    if (names.length) meta.attachments = names.join(', ');

    // Only the current version is exported. Where there were earlier ones, say
    // how many, so "this document was amended twice" is not information the
    // export silently throws away.
    if (deps.versionsOf && doc.updated_at !== doc.created_at) {
      try {
        const total = await deps.versionsOf(doc);
        if (total > 1) meta.prior_versions = String(total - 1);
      } catch (e) {
        failed.push(`${doc.meta.title || '(untitled)'}: version count (${e})`);
      }
    }

    files[path] = strToU8(serializeDocument(meta, doc.body));

    if ((i + 1) % YIELD_EVERY === 0 || i === planned.length - 1) {
      deps.onProgress?.(i + 1, planned.length);
      await yieldTo();
    }
  }

  const bytes = zipSync(files, { level: 6 });
  return { bytes, documents: planned.length, attachments, failed };
}

/** `ark-archive-2026-08-19.zip` — dated, because exports accumulate. */
export function archiveFileName(now: Date = new Date()): string {
  return `ark-archive-${now.toISOString().slice(0, 10)}.zip`;
}
