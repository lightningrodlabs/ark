import { describe, expect, it, vi } from 'vitest';
import { matchAttachments, planImport, runImport } from './importer';
import type { DocumentSummary, Folder } from '../types';

const file = (name: string, text: string) => ({ name, text });

const minutes = (node: number, committee: string, date: string) =>
  file(
    `${date} ${committee}.md`,
    `---\ntitle: "${committee} Minutes: ${date}"\ncommittee: ${committee}\nmeeting_date: ${date}\ndrupal_node: ${node}\n---\n\nBody for ${node}.\n`,
  );

const minutesWithAttachment = (
  node: number,
  committee: string,
  date: string,
  attachment: string,
) =>
  file(
    `${date} ${committee}.md`,
    `---\ntitle: "${committee} Minutes: ${date}"\ncommittee: ${committee}\nmeeting_date: ${date}\ndrupal_node: ${node}\nattachments:\n  - "${attachment}"\n---\n\nBody for ${node}.\n`,
  );

const folders: Folder[] = [
  { id: 'fnl', name: 'Finance and Legal', parent: null, order: 0, deleted: false },
];

const existingDoc = (importId: string): DocumentSummary => ({
  original: new Uint8Array([1]) as any,
  latest: new Uint8Array([1]) as any,
  author: new Uint8Array([1]) as any,
  created_at: 0,
  updated_at: 0,
  body: '',
  meta: { import_id: importId },
});

describe('planImport', () => {
  it('plans one document per file with folder, title and date mapped', () => {
    const plan = planImport([minutes(1802, 'Finance and Legal', '2026-08-12')], [], folders);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].folderName).toEqual('Finance and Legal');
    expect(plan.create[0].date).toEqual('2026-08-12');
    expect(plan.create[0].import_id).toEqual('drupal:1802');
    expect(plan.create[0].body.trim()).toEqual('Body for 1802.');
  });

  it('lists folders that do not exist yet', () => {
    const plan = planImport([minutes(1, 'Community Life', '2026-01-01')], [], folders);
    expect(plan.newFolders).toEqual(['Community Life']);
  });

  it('does not list a folder that already exists', () => {
    const plan = planImport([minutes(1, 'Finance and Legal', '2026-01-01')], [], folders);
    expect(plan.newFolders).toEqual([]);
  });

  it('skips a file whose import_id is already in the archive', () => {
    const existing = [existingDoc('drupal:1802')];
    const plan = planImport([minutes(1802, 'Finance and Legal', '2026-08-12')], existing, folders);
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([
      { name: '2026-08-12 Finance and Legal.md', import_id: 'drupal:1802' },
    ]);
  });

  it('falls back to a filename-based import_id with no drupal_node', () => {
    const plan = planImport([file('notes.md', '---\ntitle: Notes\n---\nbody')], [], folders);
    expect(plan.create[0].import_id).toEqual('file:notes.md');
  });

  it('dedupes two files that claim the same import_id', () => {
    const dupe = minutes(1802, 'Finance and Legal', '2026-08-12');
    const plan = planImport([dupe, { ...dupe, name: 'copy.md' }], [], folders);
    expect(plan.create).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });
});

describe('runImport', () => {
  it('creates missing folders once and files each document into its folder', async () => {
    const ark = { createDocument: vi.fn(async (_input: any) => new Uint8Array([9]) as any) };
    const tree = { addFolder: vi.fn(async (name: string) => `id-${name}`) };
    const plan = planImport(
      [minutes(1, 'Community Life', '2026-01-01'), minutes(2, 'Community Life', '2026-02-01')],
      [],
      folders,
    );

    const result = await runImport(plan, { ark: ark as any, tree: tree as any, folders });

    expect(tree.addFolder).toHaveBeenCalledTimes(1);
    expect(ark.createDocument).toHaveBeenCalledTimes(2);
    expect(ark.createDocument.mock.calls[0][0].folder_id).toEqual('id-Community Life');
    expect(ark.createDocument.mock.calls[0][0].meta.import_id).toEqual('drupal:1');
    expect(result.created).toEqual(2);
  });

  it('writes nothing when everything was skipped', async () => {
    const ark = { createDocument: vi.fn() };
    const tree = { addFolder: vi.fn() };
    const plan = planImport(
      [minutes(1802, 'Finance and Legal', '2026-08-12')],
      [existingDoc('drupal:1802')],
      folders,
    );
    const result = await runImport(plan, { ark: ark as any, tree: tree as any, folders });
    expect(ark.createDocument).not.toHaveBeenCalled();
    expect(result.created).toEqual(0);
  });
});

describe('matchAttachments', () => {
  it('matches a document whose named attachment is present among the picked files', () => {
    const plan = planImport(
      [minutesWithAttachment(1, 'Finance and Legal', '2026-01-01', 'budget.pdf')],
      [],
      folders,
    );
    const budget = new File(['x'], 'budget.pdf');
    const matches = matchAttachments(plan.create, [{ name: 'budget.pdf', file: budget }]);
    expect(matches.get(plan.create[0].import_id)).toEqual([budget]);
  });

  it('leaves a document unmatched when its named attachment was not among the picked files', () => {
    const plan = planImport(
      [minutesWithAttachment(2, 'Finance and Legal', '2026-01-02', 'roster.pdf')],
      [],
      folders,
    );
    const matches = matchAttachments(plan.create, []);
    expect(matches.has(plan.create[0].import_id)).toBe(false);
  });

  it('matches by basename when the picked file carries a directory prefix', () => {
    const plan = planImport(
      [minutesWithAttachment(3, 'Finance and Legal', '2026-01-03', 'roster.pdf')],
      [],
      folders,
    );
    const roster = new File(['x'], 'roster.pdf');
    const matches = matchAttachments(plan.create, [
      { name: 'finance-and-legal/roster.pdf', file: roster },
    ]);
    expect(matches.get(plan.create[0].import_id)).toEqual([roster]);
  });
});
