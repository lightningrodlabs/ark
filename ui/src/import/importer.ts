import type { ActionHash } from '@holochain/client';
import type { FileStorageClient } from '@holochain-open-dev/file-storage';
import type { ArkClient } from '../ark-client';
import type { TreeStore } from '../stores/tree.svelte';
import type { DocumentSummary, Folder } from '../types';
import { parseFrontMatter } from './frontmatter';
import { decodeAttachment, isIndexableText } from '../attachments/text';

export interface ImportFile {
  name: string;
  text: string;
}

export interface PlannedDoc {
  name: string;
  title: string;
  date: string;
  folderName: string;
  import_id: string;
  body: string;
  attachments: string[];
}

export interface ImportPlan {
  create: PlannedDoc[];
  skipped: { name: string; import_id: string }[];
  newFolders: string[];
}

const UNFILED = 'Unfiled';

/**
 * A dry run. Nothing is written until runImport is called with this plan, so
 * the user sees exactly what an import will do — including what it will skip
 * because the archive already has it.
 */
export function planImport(
  files: ImportFile[],
  existing: DocumentSummary[],
  folders: Folder[],
): ImportPlan {
  const known = new Set(
    existing.map((doc) => doc.meta.import_id).filter((id): id is string => Boolean(id)),
  );
  const folderNames = new Set(folders.filter((f) => !f.deleted).map((f) => f.name));

  const create: PlannedDoc[] = [];
  const skipped: { name: string; import_id: string }[] = [];
  const newFolders: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const { meta, body } = parseFrontMatter(file.text);
    const import_id = meta.drupal_node ? `drupal:${meta.drupal_node}` : `file:${file.name}`;

    if (known.has(import_id) || seen.has(import_id)) {
      skipped.push({ name: file.name, import_id });
      continue;
    }
    seen.add(import_id);

    const folderName = meta.committee || UNFILED;
    if (!folderNames.has(folderName) && !newFolders.includes(folderName)) {
      newFolders.push(folderName);
    }

    create.push({
      name: file.name,
      title: meta.title || file.name.replace(/\.md$/i, ''),
      date: meta.meeting_date || meta.date || '',
      folderName,
      import_id,
      body,
      attachments: (meta.attachments ?? '')
        .split(/[,\n]/)
        .map((a) => a.trim())
        .filter(Boolean),
    });
  }

  return { create, skipped, newFolders };
}

export interface AttachmentMatch {
  byImportId: Map<string, File[]>;
  /** Named in front matter but not attachable, with the reason. */
  unmatched: { title: string; name: string; reason: 'not found' | 'ambiguous' }[];
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;

/**
 * Match each planned document's front-matter attachment names against the files
 * the user picked.
 *
 * Prefers a file in the same directory as the document, because generic names
 * recur across an export — several meetings can each ship an `agenda.pdf`. A
 * global first-wins match would attach one meeting's agenda to every document
 * that mentions the name, and a plausible wrong attachment is worse than a
 * missing one: nobody goes looking for it. Where the name is genuinely
 * ambiguous this reports rather than guesses.
 */
export function matchAttachments(
  planned: PlannedDoc[],
  files: { name: string; file: File }[],
): AttachmentMatch {
  const byBase = new Map<string, { dir: string; file: File }[]>();
  for (const f of files) {
    const base = baseOf(f.name);
    byBase.set(base, [...(byBase.get(base) ?? []), { dir: dirOf(f.name), file: f.file }]);
  }

  const byImportId = new Map<string, File[]>();
  const unmatched: AttachmentMatch['unmatched'] = [];
  for (const doc of planned) {
    const docDir = dirOf(doc.name);
    const matched: File[] = [];
    for (const wanted of doc.attachments) {
      const candidates = byBase.get(baseOf(wanted)) ?? [];
      const sameDir = candidates.filter((c) => c.dir === docDir);
      const pick =
        sameDir.length === 1 ? sameDir[0] : candidates.length === 1 ? candidates[0] : undefined;
      if (pick) matched.push(pick.file);
      else {
        unmatched.push({
          title: doc.title,
          name: wanted,
          reason: candidates.length === 0 ? 'not found' : 'ambiguous',
        });
      }
    }
    if (matched.length) byImportId.set(doc.import_id, matched);
  }
  return { byImportId, unmatched };
}

/**
 * Read a File's bytes via FileReader rather than `File.arrayBuffer()` — the
 * latter is unimplemented in some Blob polyfills (including this project's
 * own jsdom test environment), while FileReader is universally supported.
 */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function runImport(
  plan: ImportPlan,
  deps: {
    ark: ArkClient;
    tree: TreeStore;
    folders: Folder[];
    files?: FileStorageClient;
    attachments?: Map<string, File[]>;
    /**
     * Called with a text attachment's decoded content as it is uploaded, so
     * the search index picks it up during import rather than waiting for a
     * human to open the document and trigger `Attachments.svelte`'s own
     * indexing. Optional and narrow (not the SearchStore itself) so this
     * module does not depend on the store.
     */
    onAttachmentText?: (original: ActionHash, name: string, text: string) => void;
  },
): Promise<{ created: number; attached: number; attachmentsFailed: string[] }> {
  const idByName = new Map(
    deps.folders.filter((f) => !f.deleted).map((f) => [f.name, f.id] as const),
  );
  for (const name of plan.newFolders) {
    idByName.set(name, await deps.tree.addFolder(name, null));
  }

  let created = 0;
  let attached = 0;
  const attachmentsFailed: string[] = [];
  for (const planned of plan.create) {
    const original = await deps.ark.createDocument({
      body: planned.body,
      meta: {
        title: planned.title,
        date: planned.date,
        import_id: planned.import_id,
      },
      folder_id: idByName.get(planned.folderName) ?? null,
    });
    created++;

    // Attachments are part of the archive, so a failure here is reported, not
    // thrown: losing the document because its budget spreadsheet would not
    // upload would be a worse outcome than an incomplete document plus a note.
    const files = deps.attachments?.get(planned.import_id) ?? [];
    for (const file of files) {
      try {
        const hash = await deps.files!.uploadFile(file);
        await deps.ark.attachFile(original, hash);
        attached++;
        // Index eagerly, right while the bytes are already in hand, instead
        // of leaving attachment search dead until someone happens to open
        // this document. Twenty-five files (one import slice) is trivial to
        // do eagerly.
        if (deps.onAttachmentText && isIndexableText(file.name, file.type)) {
          const bytes = await readFileBytes(file);
          deps.onAttachmentText(original, file.name, decodeAttachment(bytes));
        }
      } catch (e) {
        attachmentsFailed.push(`${planned.title}: ${file.name} (${e})`);
      }
    }
  }
  return { created, attached, attachmentsFailed };
}
