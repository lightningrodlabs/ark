import type { AppClient } from '@holochain/client';
import type { AppletServices, RecordInfo, WAL } from '@theweave/api';
import { ArkClient } from './ark-client';

/**
 * Bootstrap Icons ("file-earmark-text" / "file-earmark-richtext"), matching
 * the inline-data-URI style `shoelace.ts` uses for the same reason: no fetch,
 * no assets directory, nothing to go wrong in a sandboxed offline iframe. The
 * two differ only enough that a "rendered" pocket item is visually distinct
 * from the plain document one sitting next to it.
 */
function fileIcon(bodyPath: string): string {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0Zm0 1v2A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5Z"/>${bodyPath}</svg>`,
    )
  );
}

const DOCUMENT_ICON = fileIcon(
  '<path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5ZM5 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5ZM5.5 11a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2Z"/>',
);
const RENDERED_ICON = fileIcon(
  '<path d="M7 4.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5ZM4 6.5A.5.5 0 0 1 4.5 6h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5ZM4.5 8a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5ZM4 10.5a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H4.5a.5.5 0 0 1-.5-.5Z"/>',
);

/**
 * ark exposes no creatables or block types in the MVP, and no cross-applet
 * search (that needs its own DNA-side query and runs headless outside this
 * app — out of scope here, see the dispatch brief). getAssetInfo is the one
 * hook Moss actually needs: it is what lets a document dropped in the pocket
 * show a real title and icon instead of nothing.
 */
export const appletServices: AppletServices = {
  creatables: {},
  blockTypes: {},
  getAssetInfo: async (
    appletClient: AppClient,
    wal: WAL,
    _recordInfo?: RecordInfo,
  ) => {
    try {
      const ark = new ArkClient(appletClient);
      const doc = await ark.getDocument(wal.hrl[1]);
      // A document can be trashed, or simply not exist any more by the time
      // Moss asks — this is not an error, just nothing to show.
      if (!doc) return undefined;
      const rendered = wal.context?.view === 'rendered';
      return {
        name: doc.meta.title ?? '(untitled)',
        icon_src: rendered ? RENDERED_ICON : DOCUMENT_ICON,
      };
    } catch {
      return undefined;
    }
  },
  search: async () => [],
};
