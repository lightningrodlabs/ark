import MiniSearch, { type SearchResult } from 'minisearch';
import { encodeHashToBase64, type ActionHash } from '@holochain/client';
import type { DocumentSummary, Folder } from '../types';
import { descendantIds } from '../tree/paths';
import { matchesParsed, parseQuery, type ParsedQuery } from './query';
import { snippet, type Snippet } from './snippet';

export interface SearchFilters {
  folderId: string | null;
  folders: Folder[];
  from: string | null;
  to: string | null;
  author: string | null;
  includeTrashed: boolean;
  /**
   * Whether a query that matches nothing exactly may fall back to near
   * matches. Not a post-filter like the rest of this struct — it selects how
   * the search runs — but it rides here because this is the one object the
   * view hands the index, and the user sets it in the same panel as the
   * others. Off means `asdf` returns nothing and says so.
   */
  nearMatches: boolean;
}

export interface SearchHit {
  doc: DocumentSummary;
  score: number;
  field: 'title' | 'body' | 'attachment';
  attachmentName?: string;
  snippet: Snippet;
  /**
   * What this particular hit matched, and therefore what to mark wherever it
   * is shown — the snippet in the result list AND the document it opens.
   *
   * Carried per hit rather than re-derived from the query because on the
   * near-match path they are not the same thing: a hit for `asdf` matched the
   * index term `asif`, and marking the query would mark nothing. A hit whose
   * highlight is empty is a hit the app cannot justify, which is the whole
   * defect this field exists to make impossible.
   */
  highlight: string[];
}

/** Why a result set came from near matches, and what it actually matched. */
export interface NearMatch {
  /** The positive terms the user typed, which matched nothing exactly. */
  query: string[];
  /** The index terms the fuzzy retry matched instead, first-seen order. */
  terms: string[];
}

export interface SearchOutcome {
  hits: SearchHit[];
  /**
   * Non-null only when the exact search found nothing and the fuzzy retry
   * found something. The UI must say so: results the user did not ask for,
   * presented as if they were, is how "84 hits for `asdf`" happened.
   */
  nearMatch: NearMatch | null;
}

interface IndexedDoc {
  id: string;
  title: string;
  body: string;
  attachment_text: string;
}

/**
 * The whole archive in one in-memory index. Field boosts put a title match
 * above a body match; attachment text is indexed under its parent document so a
 * hit always resolves to a document the user can open.
 */
export class ArkIndex {
  private mini = new MiniSearch<IndexedDoc>({
    fields: ['title', 'body', 'attachment_text'],
    storeFields: ['title'],
    // No `fuzzy` here. Fuzziness is not a property of the index, it is a
    // deliberate second attempt made only when the exact search came up
    // empty — see `search`. Left on as a default it makes every ordinary
    // query answer with words the user did not type.
    searchOptions: { boost: { title: 4, body: 1, attachment_text: 0.5 }, prefix: true },
  });

  private docs = new Map<string, DocumentSummary>();
  private attachments = new Map<string, { name: string; text: string }[]>();
  private filings = new Map<string, string | null>();
  private trashed = new Set<string>();

  keyOf(hash: ActionHash): string {
    return encodeHashToBase64(hash);
  }

  private indexedFor(doc: DocumentSummary): IndexedDoc {
    const id = this.keyOf(doc.original);
    return {
      id,
      title: doc.meta.title ?? '',
      body: doc.body,
      attachment_text: (this.attachments.get(id) ?? []).map((a) => a.text).join('\n'),
    };
  }

  rebuild(docs: DocumentSummary[]): void {
    this.mini.removeAll();
    this.docs = new Map(docs.map((d) => [this.keyOf(d.original), d]));
    this.mini.addAll(docs.map((d) => this.indexedFor(d)));
  }

  /**
   * Index one document, replacing whatever version was there.
   *
   * Re-indexing a document whose indexed TEXT has not changed only refreshes
   * the stored summary; it does not touch MiniSearch. That is not an
   * optimisation, it is what makes this safe to call twice on the same
   * document. `discard` leaves the old posting entries in the inverted index
   * until a vacuum, and `search` both counts them in the document frequency
   * BM25 divides by and cleans them up as it walks them — so a pointless
   * discard/add pair moves scores and reorders ties. The initial load feeds
   * every arriving page through here, and a page can arrive twice (a retry,
   * an overlapping re-page); it has to leave the index exactly as one pass
   * would.
   *
   * Only `title` and `body` are compared because only they and the
   * attachment text are indexed, and attachment text cannot change here —
   * `setAttachmentText`/`removeAttachmentText` change it, and they re-index
   * unconditionally. Everything else on a summary (date, author, `latest`)
   * is read from `docs`, which is always updated.
   */
  upsert(doc: DocumentSummary): void {
    const id = this.keyOf(doc.original);
    const previous = this.docs.get(id);
    this.docs.set(id, doc);
    if (
      previous &&
      previous.body === doc.body &&
      (previous.meta.title ?? '') === (doc.meta.title ?? '')
    ) {
      return;
    }
    this.reindex(id, doc);
  }

  /**
   * A page of documents as it arrives. MiniSearch's own `addAll` is a plain
   * loop over `add`, so batching buys nothing beyond the call itself — this
   * exists so callers do not each write the loop, and so the idempotence
   * guard above is on the path they all take.
   */
  upsertAll(docs: DocumentSummary[]): void {
    for (const doc of docs) this.upsert(doc);
  }

  /** Unconditionally re-index a document already recorded in `docs`. */
  private reindex(id: string, doc: DocumentSummary): void {
    if (this.mini.has(id)) this.mini.discard(id);
    this.mini.add(this.indexedFor(doc));
  }

  remove(original: ActionHash): void {
    const id = this.keyOf(original);
    if (this.docs.has(id)) this.mini.discard(id);
    this.docs.delete(id);
    this.attachments.delete(id);
    this.filings.delete(id);
    this.trashed.delete(id);
  }

  setAttachmentText(original: ActionHash, name: string, text: string): void {
    const id = this.keyOf(original);
    const list = this.attachments.get(id) ?? [];
    this.attachments.set(id, [...list.filter((a) => a.name !== name), { name, text }]);
    const doc = this.docs.get(id);
    // Not `upsert`: the document itself is unchanged, so the guard there
    // would (correctly, for its own callers) skip the re-index that is the
    // entire point of this call.
    if (doc) this.reindex(id, doc);
  }

  /** Forget one attachment's text, e.g. when it is detached from the document. */
  removeAttachmentText(original: ActionHash, name: string): void {
    const id = this.keyOf(original);
    const list = this.attachments.get(id);
    if (!list) return;
    const remaining = list.filter((a) => a.name !== name);
    if (remaining.length === list.length) return;
    if (remaining.length === 0) this.attachments.delete(id);
    else this.attachments.set(id, remaining);
    const doc = this.docs.get(id);
    if (doc) this.reindex(id, doc);
  }

  setFilings(filings: Map<string, string | null>): void {
    this.filings = filings;
  }

  setTrashed(trashed: Set<string>): void {
    this.trashed = trashed;
  }

  private passesFilters(id: string, doc: DocumentSummary, filters: SearchFilters): boolean {
    if (!filters.includeTrashed && this.trashed.has(id)) return false;
    if (filters.folderId) {
      const allowed = new Set(descendantIds(filters.folders, filters.folderId));
      const folder = this.filings.get(id);
      if (!folder || !allowed.has(folder)) return false;
    }
    const date = doc.meta.date ?? '';
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.author && encodeHashToBase64(doc.author) !== filters.author) return false;
    return true;
  }

  /**
   * One pass of the index at a fixed fuzziness, post-filtered and turned into
   * hits. `fuzzy: false` is the ordinary search; the fuzzy pass exists only
   * as the fallback `search` runs when this one comes back empty.
   */
  private collect(parsed: ParsedQuery, filters: SearchFilters, fuzzy: boolean): SearchHit[] {
    const results = this.mini.search(parsed.terms.join(' '), {
      combineWith: parsed.combineWith,
      prefix: true,
      fuzzy: fuzzy ? 0.2 : false,
      boost: { title: 4, body: 1, attachment_text: 0.5 },
    });

    const hits: SearchHit[] = [];
    for (const result of results) {
      const doc = this.docs.get(result.id);
      if (!doc) continue;
      if (!this.passesFilters(result.id, doc, filters)) continue;

      const attachmentList = this.attachments.get(result.id) ?? [];
      const haystack = [doc.meta.title ?? '', doc.body, ...attachmentList.map((a) => a.text)].join(
        '\n',
      );
      if (!matchesParsed(haystack, parsed)) continue;

      // On the exact pass every hit contains what the user typed, so the
      // query's own highlight list (phrases whole, exclusions absent) is
      // right. On the fuzzy pass it is not: the hit contains `asif`, not
      // `asdf`. MiniSearch reports the index terms each result matched, and
      // those are the only strings that can be marked in it.
      const highlight = fuzzy ? matchedTerms(result) : parsed.highlight;

      // A hit with nothing to mark is exactly the failure this work exists to
      // remove — it renders as a result with a blank snippet and a document
      // that highlights nothing. MiniSearch always reports the terms behind a
      // result, so reaching here means an assumption above is wrong; say so
      // rather than shipping the blank row that hid it last time.
      if (highlight.length === 0) {
        throw new Error(
          `search: no matched terms for result ${result.id} — a hit that cannot be highlighted`,
        );
      }

      const matchedAttachment = attachmentList.find((a) =>
        highlight.some((t) => a.text.toLowerCase().includes(t)),
      );
      const inBody = highlight.some((t) => doc.body.toLowerCase().includes(t));
      // Title is the fall-through, so it has to be reached on purpose rather
      // than by every test above failing to fire. A fuzzy hit contains none
      // of the query's terms, so testing those literally sent every near
      // match down this branch and labelled it a title match.
      const field: SearchHit['field'] = inBody
        ? 'body'
        : matchedAttachment
          ? 'attachment'
          : 'title';

      hits.push({
        doc,
        score: result.score,
        field,
        attachmentName: field === 'attachment' ? matchedAttachment!.name : undefined,
        snippet: snippet(field === 'attachment' ? matchedAttachment!.text : doc.body, highlight),
        highlight,
      });
    }
    return hits.sort((a, b) => b.score - a.score);
  }

  search(raw: string, filters: SearchFilters): SearchOutcome {
    const parsed = parseQuery(raw);

    // A query with no positive terms, no phrases, and no exclusions is empty
    // — clearing the search box, possibly with a filter (or "include
    // trashed") still set. That must yield zero hits, not the whole archive:
    // filter-only browsing was a deliberate capability and this is its
    // deliberate removal (see docs/dev/fix-brief-template.md's Task B
    // dispatch). An exclusion-only query (`-draft`, no positive term) is NOT
    // empty in this sense — it has terms in `parsed.excluded` — and must keep
    // working: everything passing the filters *and* the exclusion, ordered by
    // date descending.
    if (parsed.terms.length === 0 && parsed.phrases.length === 0 && parsed.excluded.length === 0) {
      return { hits: [], nearMatch: null };
    }

    // Reaching here means parsed.excluded is non-empty (the pure-empty case
    // above already returned) — an exclusion-only query like `-draft`.
    if (parsed.terms.length === 0 && parsed.phrases.length === 0) {
      const hits = [...this.docs.entries()]
        .filter(([id, doc]) => this.passesFilters(id, doc, filters))
        .filter(([id, doc]) => {
          const attachments = this.attachments.get(id) ?? [];
          const haystack = [doc.meta.title ?? '', doc.body, ...attachments.map((a) => a.text)].join(
            '\n',
          );
          return matchesParsed(haystack, parsed);
        })
        .map(([, doc]) => ({
          doc,
          score: 0,
          field: 'body' as const,
          snippet: snippet(doc.body, []),
          // Deliberately nothing. An exclusion is a reason a document is
          // absent from the results, never something to point at inside one,
          // so these hits have nothing to mark and that is not the blank
          // highlight the fuzzy path produced — there is no term here that
          // the user asked to see.
          highlight: [],
        }))
        .sort((a, b) => (b.doc.meta.date ?? '').localeCompare(a.doc.meta.date ?? ''));
      return { hits, nearMatch: null };
    }

    const exact = this.collect(parsed, filters, false);
    if (exact.length > 0 || !filters.nearMatches) return { hits: exact, nearMatch: null };

    // Nothing matched what was typed. Rather than go quiet, try again within
    // one edit — but as an explicitly labelled second answer, never as extra
    // rows silently mixed into the first. `qwerty` still returns nothing;
    // `asdf` returns the `asif` documents and says that is what it did.
    const near = this.collect(parsed, filters, true);
    if (near.length === 0) return { hits: near, nearMatch: null };

    const terms: string[] = [];
    for (const hit of near) {
      for (const term of hit.highlight) if (!terms.includes(term)) terms.push(term);
    }
    return { hits: near, nearMatch: { query: parsed.terms, terms } };
  }
}

/**
 * The index terms one result matched, lowercased and deduplicated.
 *
 * `result.terms` is MiniSearch's own record of what it matched this document
 * on, which is the only honest source for "what should be highlighted in a
 * document that does not contain the query".
 */
function matchedTerms(result: SearchResult): string[] {
  const seen: string[] = [];
  for (const term of result.terms) {
    const lower = term.toLowerCase();
    if (lower && !seen.includes(lower)) seen.push(lower);
  }
  return seen;
}
