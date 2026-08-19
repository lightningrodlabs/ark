import MiniSearch from 'minisearch';
import { encodeHashToBase64, type ActionHash } from '@holochain/client';
import type { DocumentSummary, Folder } from '../types';
import { descendantIds } from '../tree/paths';
import { matchesParsed, parseQuery } from './query';
import { snippet, type Snippet } from './snippet';

export interface SearchFilters {
  folderId: string | null;
  folders: Folder[];
  from: string | null;
  to: string | null;
  author: string | null;
  includeTrashed: boolean;
}

export interface SearchHit {
  doc: DocumentSummary;
  score: number;
  field: 'title' | 'body' | 'attachment';
  attachmentName?: string;
  snippet: Snippet;
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
    searchOptions: { boost: { title: 4, body: 1, attachment_text: 0.5 }, prefix: true, fuzzy: 0.2 },
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

  upsert(doc: DocumentSummary): void {
    const id = this.keyOf(doc.original);
    if (this.docs.has(id)) this.mini.discard(id);
    this.docs.set(id, doc);
    this.mini.add(this.indexedFor(doc));
  }

  remove(original: ActionHash): void {
    const id = this.keyOf(original);
    if (this.docs.has(id)) this.mini.discard(id);
    this.docs.delete(id);
    this.attachments.delete(id);
  }

  setAttachmentText(original: ActionHash, name: string, text: string): void {
    const id = this.keyOf(original);
    const list = this.attachments.get(id) ?? [];
    this.attachments.set(id, [...list.filter((a) => a.name !== name), { name, text }]);
    const doc = this.docs.get(id);
    if (doc) this.upsert(doc);
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

  search(raw: string, filters: SearchFilters): SearchHit[] {
    const parsed = parseQuery(raw);

    // An empty query is a browse: filters alone, ordered by date descending.
    if (parsed.terms.length === 0 && parsed.phrases.length === 0) {
      return [...this.docs.entries()]
        .filter(([id, doc]) => this.passesFilters(id, doc, filters))
        .map(([, doc]) => ({
          doc,
          score: 0,
          field: 'body' as const,
          snippet: snippet(doc.body, []),
        }))
        .sort((a, b) => (b.doc.meta.date ?? '').localeCompare(a.doc.meta.date ?? ''));
    }

    const results = this.mini.search(parsed.terms.join(' '), {
      combineWith: parsed.combineWith,
      prefix: true,
      fuzzy: 0.2,
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

      const matchedAttachment = attachmentList.find((a) =>
        parsed.terms.some((t) => a.text.toLowerCase().includes(t)),
      );
      const inBody = parsed.terms.some((t) => doc.body.toLowerCase().includes(t));
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
        snippet: snippet(
          field === 'attachment' ? matchedAttachment!.text : doc.body,
          parsed.terms,
        ),
      });
    }
    return hits.sort((a, b) => b.score - a.score);
  }
}
