import type { AppletServices } from '@theweave/api';

/**
 * ark exposes no creatables or block types in the MVP, and no cross-applet
 * search. The object still has to exist for WeaveClient.connect.
 */
export const appletServices: AppletServices = {
  creatables: {},
  blockTypes: {},
  getAssetInfo: async () => undefined,
  search: async () => [],
};
