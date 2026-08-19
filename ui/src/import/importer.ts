import type { ArkClient } from '../ark-client';
import type { TreeStore } from '../stores/tree.svelte';
import type { DocumentSummary, Folder } from '../types';
import { parseFrontMatter } from './frontmatter';

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
    });
  }

  return { create, skipped, newFolders };
}

export async function runImport(
  plan: ImportPlan,
  deps: { ark: ArkClient; tree: TreeStore; folders: Folder[] },
): Promise<{ created: number }> {
  const idByName = new Map(
    deps.folders.filter((f) => !f.deleted).map((f) => [f.name, f.id] as const),
  );
  for (const name of plan.newFolders) {
    idByName.set(name, await deps.tree.addFolder(name, null));
  }

  let created = 0;
  for (const planned of plan.create) {
    await deps.ark.createDocument({
      body: planned.body,
      meta: {
        title: planned.title,
        date: planned.date,
        import_id: planned.import_id,
      },
      folder_id: idByName.get(planned.folderName) ?? null,
    });
    created++;
  }
  return { created };
}
