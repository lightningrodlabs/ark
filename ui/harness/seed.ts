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
