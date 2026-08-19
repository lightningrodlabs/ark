import { describe, expect, it } from 'vitest';
import { previewMode } from './preview';

describe('previewMode', () => {
  it('treats indexable text attachments as previewable text', () => {
    expect(previewMode('notes.md', 'application/octet-stream')).toBe('text');
    expect(previewMode('notes.txt', '')).toBe('text');
    expect(previewMode('budget.csv', '')).toBe('text');
    expect(previewMode('report', 'text/plain')).toBe('text');
  });

  it('treats images as previewable by MIME type', () => {
    expect(previewMode('photo.jpg', 'image/jpeg')).toBe('image');
    expect(previewMode('scan', 'image/png')).toBe('image');
  });

  it('treats images as previewable by extension when the MIME type is missing', () => {
    expect(previewMode('photo.PNG', '')).toBe('image');
    expect(previewMode('diagram.svg', 'application/octet-stream')).toBe('image');
  });

  it('has no preview for anything else, including PDF', () => {
    expect(previewMode('roster.pdf', 'application/pdf')).toBe('none');
    expect(previewMode('budget.xlsx', 'application/vnd.ms-excel')).toBe('none');
  });
});
