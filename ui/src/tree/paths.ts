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
