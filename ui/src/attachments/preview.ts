import { isIndexableText } from './text';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

export type PreviewMode = 'text' | 'image' | 'none';

/**
 * Decides how (or whether) an attachment can be shown inline in the applet,
 * without ever fetching its bytes. Text attachments are the same set the
 * search index already indexes (see `isIndexableText`); images get an
 * `<img>` preview; everything else — including PDF — cannot be previewed
 * in-app and is download-only.
 */
export function previewMode(name: string, fileType: string): PreviewMode {
  if (isIndexableText(name, fileType)) return 'text';
  if (fileType.startsWith('image/')) return 'image';
  const lower = name.toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image';
  return 'none';
}
