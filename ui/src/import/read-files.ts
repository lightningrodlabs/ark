import type { ImportFile } from './importer';

/**
 * Reading the files the user picked.
 *
 * Everything in the import path that touches a `File` handle goes through this
 * module, because reading one is the only step that can fail for reasons that
 * have nothing to do with the archive — and on the reference corpus it did.
 * Importing it in live Moss died with:
 *
 *     NotReadableError: The requested file could not be read, typically due to
 *     permission problems that have occurred after a reference to a file was
 *     acquired.
 *
 * The evidence points at how many reads were started at once. The whole folder
 * fails in live Moss; a smaller subset of the SAME folder imports fine; and the
 * whole folder also imports fine under `applet-dev`, where the applet is served
 * from vite over `http://localhost:8888` rather than the packaged UI over the
 * `applet://` scheme. Size is what separates the two live runs, so the panel's
 * old `Promise.all` over every picked markdown file is the trigger, and the
 * environment differs only in how much of it it tolerates — dev survived it,
 * which is luck rather than evidence that it was ever sound.
 *
 * So: `READ_CONCURRENCY` bounds how many reads are in flight, `withReadRetry`
 * absorbs a read that fails transiently anyway, and — because the environment
 * has already been wrong once about what it would tolerate — a read that still
 * fails is reported by name rather than escaping as an unhandled rejection that
 * leaves the panel inert.
 */

/**
 * How many file reads may be in flight at once.
 *
 * The archive this tool exists for is one picked folder of 4251 files, ~1409 of
 * them markdown. Reading them with `Promise.all` — which is what the panel used
 * to do — starts all 1409 in the same tick, and that is what killed import on
 * the real corpus: a smaller subset of the very same folder goes through, so
 * the count is the variable that decides.
 *
 * Eight is chosen the way a browser sizes its own per-host connection pool: far
 * enough below any per-process limit on concurrent file reads that the limit is
 * never the thing that decides, while still keeping enough requests in flight
 * that the read is bound by the disk rather than by round-trip latency. Reading
 * strictly one at a time would be just as safe and needlessly slow — 1406 reads
 * serialised on a spinning disk is minutes the user spends looking at a file
 * count.
 */
export const READ_CONCURRENCY = 8;

/**
 * How many times a failed read is retried before it is reported as a failure.
 *
 * `NotReadableError` is often transient: it is what Chromium raises when a read
 * cannot be serviced right now, and the same handle frequently reads fine once
 * whatever caused it has passed. Belt to `READ_CONCURRENCY`'s braces — the bound
 * is what stops the failure, this is what covers the environment tolerating
 * even less than expected. A handle that is genuinely gone fails all three
 * attempts and is reported by name; the retry costs a fraction of a second and
 * hides nothing.
 */
export const READ_RETRIES = 2;

/** Grows with the attempt, so the second retry waits out a longer stall. */
const RETRY_DELAY_MS = 100;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `read` again if it fails, up to `READ_RETRIES` times, then rethrow the
 * last error. Only ever wrap a plain read: a retry must not repeat work that
 * has already been committed to the DHT.
 */
export async function withReadRetry<T>(
  read: () => Promise<T>,
  retries: number = READ_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAY_MS * attempt);
    try {
      return await read();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * `Promise.all` with a ceiling on how many run at once. Results keep the input
 * order regardless of the order they finish in.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** A file the user picked that could not be read, and why. */
export interface ReadFailure {
  name: string;
  error: string;
}

/**
 * Read every picked markdown file, bounded and retried, reporting progress as
 * it goes.
 *
 * A file that cannot be read is left out of the result and listed in `failed`
 * instead: one unreadable file out of 1406 must cost the user that file, not
 * the import.
 */
export async function readTextFiles(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ read: ImportFile[]; failed: ReadFailure[] }> {
  const failed: ReadFailure[] = [];
  let done = 0;
  onProgress?.(0, files.length);
  const results = await mapPool(files, READ_CONCURRENCY, async (file) => {
    // The relative path (not just the basename) is what lets matchAttachments
    // tell two same-named attachments in different meeting folders apart.
    const name = file.webkitRelativePath || file.name;
    try {
      return { name, text: await withReadRetry(() => file.text()) };
    } catch (error) {
      failed.push({ name, error: String(error) });
      return null;
    } finally {
      onProgress?.(++done, files.length);
    }
  });
  return { read: results.filter((r): r is ImportFile => r !== null), failed };
}

/**
 * Read a File's bytes via FileReader rather than `File.arrayBuffer()` — the
 * latter is unimplemented in some Blob polyfills (including this project's own
 * jsdom test environment), while FileReader is universally supported.
 */
export function readFileBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(reader.error ?? new DOMException(`could not read ${file.name}`, 'NotReadableError'));
    reader.readAsArrayBuffer(file);
  });
}
