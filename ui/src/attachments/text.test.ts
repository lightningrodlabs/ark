import { describe, expect, it } from 'vitest';
import { decodeAttachment, isIndexableText } from './text';

describe('isIndexableText', () => {
  it('accepts markdown, plain text and csv by extension', () => {
    expect(isIndexableText('notes.md', 'application/octet-stream')).toBe(true);
    expect(isIndexableText('notes.txt', '')).toBe(true);
    expect(isIndexableText('budget.csv', '')).toBe(true);
  });

  it('accepts any text MIME type', () => {
    expect(isIndexableText('report', 'text/plain')).toBe(true);
  });

  it('rejects binaries that are listed but not searched', () => {
    expect(isIndexableText('budget.xlsx', 'application/vnd.ms-excel')).toBe(false);
    expect(isIndexableText('roster.pdf', 'application/pdf')).toBe(false);
    expect(isIndexableText('photo.jpg', 'image/jpeg')).toBe(false);
  });

  it('is case insensitive about extensions', () => {
    expect(isIndexableText('NOTES.MD', '')).toBe(true);
  });
});

describe('decodeAttachment', () => {
  it('decodes utf-8', () => {
    expect(decodeAttachment(new TextEncoder().encode('café,4200\n'))).toEqual('café,4200\n');
  });

  it('does not throw on invalid bytes', () => {
    expect(() => decodeAttachment(new Uint8Array([0xff, 0xfe, 0x00]))).not.toThrow();
  });
});
