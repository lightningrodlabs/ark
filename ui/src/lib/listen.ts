import type { Action } from 'svelte/action';

/**
 * Attach DOM listeners to an element imperatively.
 *
 * Used where the element genuinely IS interactive but svelte-check cannot see
 * it. Shoelace's custom elements carry their semantics inside a shadow root —
 * `sl-icon-button` renders a real `<button>`, `sl-tree-item` a `role="treeitem"`
 * — and an `<li role="option">` in a combobox listbox is operated from the
 * input that owns focus, never from itself. In every one of those cases the
 * a11y rules fire on markup that is already correct, and the honest fix is to
 * bind the listener the way plain DOM does rather than to bolt on a keyboard
 * handler nothing will ever dispatch.
 *
 * Not an escape hatch for ordinary `<div onclick>` — that warning is right and
 * should be fixed by using a real control.
 */
export const listen: Action<HTMLElement, Record<string, (event: any) => void>> = (
  node,
  handlers = {},
) => {
  let current = handlers;
  const bound: Record<string, EventListener> = {};

  for (const type of Object.keys(current)) {
    // Read through `current` at call time so an update swaps behaviour without
    // detaching and reattaching every listener.
    const proxy: EventListener = (event) => current[type]?.(event);
    bound[type] = proxy;
    node.addEventListener(type, proxy);
  }

  return {
    update(next) {
      current = next ?? {};
    },
    destroy() {
      for (const [type, proxy] of Object.entries(bound)) node.removeEventListener(type, proxy);
    },
  };
};
