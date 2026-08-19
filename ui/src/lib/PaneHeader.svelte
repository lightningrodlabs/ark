<script lang="ts">
  /**
   * The one header the right-hand pane wears, whatever is in it.
   *
   * Two things were missing before it existed. A document could never be
   * closed — the editor had Cancel and import had Done, but an open document
   * could only ever be *replaced*, never dismissed. And nothing said what the
   * pane was showing: opening Import from the About dialog put the panel in
   * the place documents live, unannounced, which reads as the button having
   * failed.
   *
   * Rendered once by App.svelte above the pane's occupant rather than by each
   * occupant, so there is exactly one of these on screen and one place that
   * decides the title. It is a sibling of the occupant, not a wrapper, so the
   * occupants keep padding themselves (see ImportPanel / DocumentView /
   * DocumentEditor, all now on the same 1rem) and this pads itself to match.
   */
  let {
    title,
    onClose,
    closeDisabled = false,
    closeReason,
  }: {
    title: string;
    onClose: () => void;
    /** True only while closing would destroy work in progress. */
    closeDisabled?: boolean;
    /** Why it is disabled — shown on hover, so the reason is discoverable. */
    closeReason?: string;
  } = $props();
</script>

<header class="pane-header" data-testid="pane-header">
  <h2 data-testid="pane-title">{title}</h2>
  <button
    class="pane-close"
    data-testid="pane-close"
    type="button"
    aria-label="Close pane"
    title={closeDisabled ? (closeReason ?? 'Close') : 'Close'}
    disabled={closeDisabled}
    onclick={onClose}>×</button
  >
</header>

<style>
  .pane-header {
    /* The pane scrolls (App.svelte's `.pane { overflow: auto }`) and minutes
       run long, so the close button must not scroll off the top. */
    position: sticky;
    top: 0;
    z-index: 2;
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    /* Opaque, for two reasons: the document scrolling underneath must not
       show through, and a transparent background costs text its subpixel
       antialiasing inside Moss's iframe — see App.svelte's <main>. */
    background: var(--sl-color-neutral-0, #fff);
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
  }
  h2 {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 1.05rem;
    font-weight: 600;
    /* Minute titles are long and the pane is narrow; one line, clipped, so
       the header stays the same height whatever is open. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pane-close {
    flex: none;
    padding: 0 0.4rem;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font-size: 1.3rem;
    line-height: 1.4;
    cursor: pointer;
  }
  .pane-close:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.18);
  }
  .pane-close:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
