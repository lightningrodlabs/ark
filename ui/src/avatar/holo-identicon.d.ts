/**
 * @holo-host/identicon ships no types and none exist on DefinitelyTyped.
 * Minimal ambient declaration for the one function this project uses.
 */
declare module '@holo-host/identicon' {
  export interface IdenticonOptions {
    hash: Uint8Array;
    size?: number;
    backgroundColor?: string;
  }

  export default function renderIdenticon(
    opts: IdenticonOptions,
    canvas: HTMLCanvasElement,
  ): HTMLCanvasElement | undefined;
}
