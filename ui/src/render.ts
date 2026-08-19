import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Markdown to sanitized HTML.
 *
 * Bodies are written by any member of the group — that is the whole point of an
 * amendable archive — and markdown permits raw HTML, so an unsanitized `{@html}`
 * would let any member run script in every other member's page, with access to
 * their Holochain client. Paste-time cleaning is not enough: a body can be
 * written straight to the DNA without ever passing through the editor.
 *
 * Every `{@html}` in this UI renders the output of this function and nothing
 * else.
 */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string);
}
