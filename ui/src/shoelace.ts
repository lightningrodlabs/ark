/**
 * Shoelace setup for ark: cherry-picked components plus a self-contained icon
 * library.
 *
 * Components are imported one file at a time rather than from the package
 * root. The root barrel pulls in every component Shoelace ships (~70 custom
 * elements); ark uses six.
 *
 * Icons are the interesting part. By default `sl-icon` FETCHES an SVG from
 * `{basePath}/assets/icons/{name}.svg` at render time, where the base path is
 * inferred from the URL the Shoelace script was loaded from. That is wrong
 * here twice over: `dist/assets` is 8.5 MB of 2052 icons, which has no
 * business inside an applet zip, and a Moss applet runs from a sandboxed
 * Electron iframe with no network — a base path that resolved to a CDN would
 * simply render nothing. (The sibling Moss tools all leave `setBasePath`
 * commented out, which is why their `sl-icon` usage is decorative or absent.)
 *
 * Registering a resolver instead makes icons pure string returns: no fetch, no
 * assets directory, no base path, nothing to go wrong offline. Only the icons
 * ark actually names are here, and `sl-icon` renders an unknown name as
 * nothing rather than throwing, so a typo degrades quietly.
 */
/**
 * The theme stylesheet is not decoration — it DEFINES every `--sl-*` custom
 * property the components' own rules are written against. Without it
 * `font-size: var(--sl-font-size-medium)` and `line-height:
 * var(--sl-line-height-dense)` are invalid at computed-value time, and a
 * tree item's label collapses to zero height. Same choice as the sibling Moss
 * tools (kando, emergence), which import the light theme unconditionally.
 */
import '@shoelace-style/shoelace/dist/themes/light.css';
import { registerIconLibrary } from '@shoelace-style/shoelace/dist/utilities/icon-library.js';

import '@shoelace-style/shoelace/dist/components/tree/tree.js';
import '@shoelace-style/shoelace/dist/components/tree-item/tree-item.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';

/** Bootstrap Icons, the set Shoelace's default library draws from. */
const ICONS: Record<string, string> = {
  'chevron-right':
    '<path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>',
  'chevron-down':
    '<path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/>',
  'three-dots-vertical':
    '<path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>',
  pencil:
    '<path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/>',
  'folder-plus':
    '<path d="m.5 3 .04.87a2 2 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H9v-1H2.826a1 1 0 0 1-.995-.91l-.637-7A1 1 0 0 1 2.19 4h11.62a1 1 0 0 1 .996 1.09L14.54 8h1.005l.256-2.819A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2m5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19q-.362.002-.683.12L1.5 2.98a1 1 0 0 1 1-.98z"/><path d="M13.5 9a.5.5 0 0 1 .5.5V11h1.5a.5.5 0 1 1 0 1H14v1.5a.5.5 0 1 1-1 0V12h-1.5a.5.5 0 0 1 0-1H13V9.5a.5.5 0 0 1 .5-.5"/>',
  trash:
    '<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>',
};

const EMPTY =
  'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');

registerIconLibrary('default', {
  resolver: (name) => {
    const body = ICONS[name];
    if (!body) return EMPTY;
    return (
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">${body}</svg>`,
      )
    );
  },
  // Every icon is authored with `fill="currentColor"`, so it inherits the
  // surrounding text colour and needs no per-icon mutation.
  mutator: () => {},
});
