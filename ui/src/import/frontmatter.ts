import { load } from 'js-yaml';

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * YAML front matter, but only at the very start of the file — a `---` further
 * down is a horizontal rule, not metadata. Values are stringified so the whole
 * meta map stays Record<string, string>, matching the DNA's entry shape.
 */
export function parseFrontMatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = FENCE.exec(text);
  if (!match) return { meta: {}, body: text };

  let parsed: unknown;
  try {
    parsed = load(match[1]);
  } catch {
    return { meta: {}, body: text };
  }
  if (!parsed || typeof parsed !== 'object') return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    meta[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  }
  return { meta, body: text.slice(match[0].length) };
}
