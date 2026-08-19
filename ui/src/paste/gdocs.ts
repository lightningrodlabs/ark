import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Google Docs pastes carry emphasis as inline CSS on <span> rather than as
 * <strong>/<em>, wrapped in a <b style="font-weight:normal"> that must not
 * become bold. About 43% of the reference corpus looks like this. Turndown sees
 * only semantic markup, so the mapping happens here first.
 */
export function cleanGoogleDocsHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, style, object, iframe, embed').forEach((el) => el.remove());
  // Remote images are trackers far more often than content, and an archive must
  // render offline.
  doc.querySelectorAll('img').forEach((img) => {
    if (/^https?:/i.test(img.getAttribute('src') ?? '')) img.remove();
  });
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  // The wrapper Google Docs puts around a whole paste: bold tag, normal weight.
  doc.querySelectorAll('b').forEach((el) => {
    const weight = el.style.fontWeight;
    if (weight === 'normal' || weight === '400' || el.id.startsWith('docs-internal-guid')) {
      el.replaceWith(...el.childNodes);
    }
  });

  doc.querySelectorAll('span').forEach((span) => {
    const weight = span.style.fontWeight;
    const italic = span.style.fontStyle === 'italic';
    const bold = weight === 'bold' || (/^\d+$/.test(weight) && Number(weight) >= 600);
    if (bold || italic) {
      // Build the strong/em wrapper off-tree, then splice it in with a single
      // replaceWith. Interleaving createElement/append/replaceWith calls on
      // nodes already attached to the document is what produced a
      // HierarchyRequestError here originally: once a node has been moved
      // into a new parent, replacing an ancestor with that same node inserts
      // it into itself.
      let wrapper: HTMLElement;
      if (bold && italic) {
        const strong = doc.createElement('strong');
        const em = doc.createElement('em');
        em.append(...span.childNodes);
        strong.append(em);
        wrapper = strong;
      } else if (bold) {
        wrapper = doc.createElement('strong');
        wrapper.append(...span.childNodes);
      } else {
        wrapper = doc.createElement('em');
        wrapper.append(...span.childNodes);
      }
      span.replaceWith(wrapper);
    } else if (span.parentNode) {
      span.replaceWith(...span.childNodes);
    }
  });

  // Google Docs exports table header rows as bold <td>, never <th> — verified
  // across the reference corpus, where no exported table uses <th> at all. And
  // turndown-plugin-gfm only emits a GFM pipe table when the first row is all
  // <th>; otherwise it keeps the entire <table> as raw HTML. Without this
  // promotion the dominant real-world table shape lands in the archive as an
  // unreadable, uneditable HTML blob sitting inside a markdown body.
  doc.querySelectorAll('table').forEach((table) => {
    const firstRow = table.querySelector('tr');
    if (!firstRow) return;
    const cells = [...firstRow.children].filter((c) => c.tagName === 'TD');
    if (cells.length === 0) return;
    const isBold = (cell: Element) => cell.querySelector('strong, b') !== null;
    const isBlank = (cell: Element) => (cell.textContent ?? '').trim() === '';
    // Blank cells are allowed in a header row, but a row that is *only* blanks
    // and one bold cell is a data row (["", "**Total**", ""]), not a header.
    const headerish = cells.some(isBold) && cells.every((c) => isBlank(c) || isBold(c));
    if (!headerish) return;
    for (const cell of cells) {
      const th = doc.createElement('th');
      th.append(...cell.childNodes);
      cell.replaceWith(th);
    }
  });

  // Anything left with a style attribute keeps its text, loses its wrapper.
  doc.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
  doc.querySelectorAll('[id], [class]').forEach((el) => {
    el.removeAttribute('id');
    el.removeAttribute('class');
  });

  return doc.body.innerHTML;
}

function service(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  // Turndown's built-in listItem rule pads every marker out to a fixed
  // 4-column gutter ("-   item", "1.  item") with no option to change it.
  // A single space after the marker is the more common markdown style and
  // what this project's fixtures are written against.
  turndown.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      let prefix = options.bulletListMarker + ' ';
      const parent = node.parentNode as HTMLElement | null;
      if (parent && parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const isParagraph = /\n$/.test(content);
      content = content.replace(/^\n+/, '').replace(/\n+$/, '') + (isParagraph ? '\n' : '');
      content = content.replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
      return prefix + content + (node.nextSibling ? '\n' : '');
    },
  });
  return turndown;
}

export function htmlToMarkdown(html: string): string {
  return service().turndown(cleanGoogleDocsHtml(html));
}
