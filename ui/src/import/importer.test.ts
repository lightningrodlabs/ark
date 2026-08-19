import { describe, expect, it, vi } from 'vitest';
import { matchAttachments, planImport, runImport } from './importer';
import type { DocumentSummary, Folder } from '../types';

const file = (name: string, text: string) => ({ name, text });

const minutes = (node: number, committee: string, date: string) =>
  file(
    `${date} ${committee}.md`,
    `---\ntitle: "${committee} Minutes: ${date}"\ncommittee: ${committee}\nmeeting_date: ${date}\ndrupal_node: ${node}\n---\n\nBody for ${node}.\n`,
  );

const minutesText = (node: number, committee: string, date: string, attachment: string) =>
  `---\ntitle: "${committee} Minutes: ${date}"\ncommittee: ${committee}\nmeeting_date: ${date}\ndrupal_node: ${node}\nattachments:\n  - "${attachment}"\n---\n\nBody for ${node}.\n`;

const minutesWithAttachment = (node: number, committee: string, date: string, attachment: string) =>
  file(`${date} ${committee}.md`, minutesText(node, committee, date, attachment));

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
    expect(matches.byImportId.get(plan.create[0].import_id)).toEqual([budget]);
    expect(matches.unmatched).toEqual([]);
  });

  it('leaves a document unmatched when its named attachment was not among the picked files', () => {
    const plan = planImport(
      [minutesWithAttachment(2, 'Finance and Legal', '2026-01-02', 'roster.pdf')],
      [],
      folders,
    );
    const matches = matchAttachments(plan.create, []);
    expect(matches.byImportId.has(plan.create[0].import_id)).toBe(false);
    expect(matches.unmatched).toEqual([
      { title: plan.create[0].title, name: 'roster.pdf', reason: 'not found' },
    ]);
  });

  it('matches by basename when the picked file carries a directory prefix and only one candidate exists', () => {
    const plan = planImport(
      [minutesWithAttachment(3, 'Finance and Legal', '2026-01-03', 'roster.pdf')],
      [],
      folders,
    );
    const roster = new File(['x'], 'roster.pdf');
    const matches = matchAttachments(plan.create, [
      { name: 'finance-and-legal/roster.pdf', file: roster },
    ]);
    expect(matches.byImportId.get(plan.create[0].import_id)).toEqual([roster]);
  });

  it('prefers the attachment in the same directory when the same name recurs across the export', () => {
    const doc1 = file(
      'ad-hoc/2003-01-01 Ad Hoc.md',
      minutesText(101, 'Ad Hoc', '2003-01-01', 'agenda.pdf'),
    );
    const doc2 = file(
      'finance-and-legal/2003-01-02 Finance and Legal.md',
      minutesText(102, 'Finance and Legal', '2003-01-02', 'agenda.pdf'),
    );
    const plan = planImport([doc1, doc2], [], folders);
    const agendaForAdHoc = new File(['1'], 'agenda.pdf');
    const agendaForFinance = new File(['2'], 'agenda.pdf');
    const matches = matchAttachments(plan.create, [
      { name: 'ad-hoc/agenda.pdf', file: agendaForAdHoc },
      { name: 'finance-and-legal/agenda.pdf', file: agendaForFinance },
    ]);

    const planned1 = plan.create.find((d) => d.import_id === 'drupal:101')!;
    const planned2 = plan.create.find((d) => d.import_id === 'drupal:102')!;
    expect(matches.byImportId.get(planned1.import_id)).toEqual([agendaForAdHoc]);
    expect(matches.byImportId.get(planned2.import_id)).toEqual([agendaForFinance]);
    expect(matches.unmatched).toEqual([]);
  });

  it('reports "not found" when the named attachment matches no picked file at all', () => {
    const doc = file(
      'ad-hoc/2003-02-01 Ad Hoc.md',
      minutesText(103, 'Ad Hoc', '2003-02-01', 'missing.pdf'),
    );
    const plan = planImport([doc], [], folders);
    const matches = matchAttachments(plan.create, []);
    expect(matches.byImportId.has(plan.create[0].import_id)).toBe(false);
    expect(matches.unmatched).toEqual([
      { title: plan.create[0].title, name: 'missing.pdf', reason: 'not found' },
    ]);
  });

  it('reports "ambiguous" when several files share a name and none is in the document\'s directory', () => {
    const doc = file(
      'membership/2003-03-01 Membership.md',
      minutesText(104, 'Membership', '2003-03-01', 'agenda.pdf'),
    );
    const plan = planImport([doc], [], folders);
    const agendaA = new File(['a'], 'agenda.pdf');
    const agendaB = new File(['b'], 'agenda.pdf');
    const matches = matchAttachments(plan.create, [
      { name: 'ad-hoc/agenda.pdf', file: agendaA },
      { name: 'finance-and-legal/agenda.pdf', file: agendaB },
    ]);
    expect(matches.byImportId.has(plan.create[0].import_id)).toBe(false);
    expect(matches.unmatched).toEqual([
      { title: plan.create[0].title, name: 'agenda.pdf', reason: 'ambiguous' },
    ]);
  });
});
