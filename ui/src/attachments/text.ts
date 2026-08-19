const TEXT_EXTENSIONS = ['.md', '.txt', '.csv'];

/**
 * Which attachments join the search index. Binary attachments (pdf, xlsx, jpg)
 * are listed and downloadable but not searched — extracting text from them is
 * out of scope for the MVP.
 */
export function isIndexableText(name: string, fileType: string): boolean {
  if (fileType.startsWith('text/')) return true;
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function decodeAttachment(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
