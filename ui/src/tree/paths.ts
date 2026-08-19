import type { Folder } from '../types';

/** The folder itself plus every descendant. Empty if the id is unknown. */
export function descendantIds(folders: Folder[], id: string): string[] {
  if (!folders.some((f) => f.id === id)) return [];
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const folder of folders) {
      if (folder.parent === out[i] && !out.includes(folder.id)) out.push(folder.id);
    }
  }
  return out;
}

/** Root-first ancestor chain including the folder. Safe against cycles. */
export function folderPath(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return chain;
}

/**
 * Human-readable location of a folder: "Board Minutes / 2026 / Q1".
 *
 * Used by the search overlay, where a result has to answer "where is it?" as
 * well as "what is it?" — a bare folder name is ambiguous across an archive
 * with thirteen committees that each have a "2026".
 */
export function folderPathLabel(
  folders: Folder[],
  id: string | null | undefined,
  unfiled = 'Unfiled',
): string {
  if (!id) return unfiled;
  const chain = folderPath(folders, id);
  if (chain.length === 0) return unfiled;
  return chain.map((f) => f.name).join(' / ');
}
