import { describe, expect, it, vi } from 'vitest';
import {
  READ_CONCURRENCY,
  READ_RETRIES,
  mapPool,
  readTextFiles,
  withReadRetry,
} from './read-files';

const notReadable = () =>
  new DOMException(
    'The requested file could not be read, typically due to permission problems ' +
      'that have occurred after a reference to a file was acquired.',
    'NotReadableError',
  );

/**
 * A stand-in for a picked File whose read behaves however the test needs.
 *
 * A real `File` cannot be made to fail, and arranging an actual filesystem
 * failure is not something a unit test can do — but every caller here only
 * ever touches `name`, `webkitRelativePath` and `text()`.
 */
function fakeFile(
  name: string,
  text: () => Promise<string>,
  webkitRelativePath = '',
): File {
  return { name, webkitRelativePath, text } as unknown as File;
}

const reads = (name: string, body = `body of ${name}`) =>
  fakeFile(name, async () => body);

describe('mapPool', () => {
  it('never runs more than the limit at once', async () => {
    let inflight = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    await mapPool(items, 4, async (n) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 1));
      inflight--;
      return n;
    });

    expect(peak).toBe(4);
  });

  it('returns results in input order however they finish', async () => {
    const result = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it('handles an empty input without hanging', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});

describe('withReadRetry', () => {
  it('retries a read that fails once and then succeeds', async () => {
    let attempts = 0;
    const read = vi.fn(async () => {
      if (++attempts === 1) throw notReadable();
      return 'the content';
    });
    expect(await withReadRetry(read)).toEqual('the content');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('rethrows the last error once the retries are used up', async () => {
    const read = vi.fn(async () => {
      throw notReadable();
    });
    await expect(withReadRetry(read)).rejects.toThrow(/could not be read/);
    // The first attempt is not a retry.
    expect(read).toHaveBeenCalledTimes(READ_RETRIES + 1);
  });
});

describe('readTextFiles', () => {
  it('reads every file, keyed by its path within the picked folder', async () => {
    const { read, failed } = await readTextFiles([
      fakeFile('minutes.md', async () => 'one', 'Finance/2014/minutes.md'),
      reads('loose.md', 'two'),
    ]);
    expect(failed).toEqual([]);
    expect(read).toEqual([
      { name: 'Finance/2014/minutes.md', text: 'one' },
      { name: 'loose.md', text: 'two' },
    ]);
  });

  it('reports a file that cannot be read BY NAME and still returns the others', async () => {
    // The whole point: one unreadable file out of 1406 costs the user that
    // file, not the import — and it has to be findable afterwards, which a
    // bare count is not.
    const { read, failed } = await readTextFiles([
      reads('fine-1.md', 'one'),
      fakeFile('broken.md', async () => {
        throw notReadable();
      }),
      reads('fine-2.md', 'two'),
    ]);

    expect(read.map((f) => f.name)).toEqual(['fine-1.md', 'fine-2.md']);
    expect(failed).toHaveLength(1);
    expect(failed[0].name).toEqual('broken.md');
    expect(failed[0].error).toMatch(/could not be read/);
  });

  it('keeps a file that only failed the first time', async () => {
    let attempts = 0;
    const { read, failed } = await readTextFiles([
      fakeFile('flaky.md', async () => {
        if (++attempts === 1) throw notReadable();
        return 'recovered';
      }),
    ]);
    expect(failed).toEqual([]);
    expect(read).toEqual([{ name: 'flaky.md', text: 'recovered' }]);
  });

  it('does not start more reads at once than READ_CONCURRENCY', async () => {
    // The fix itself. The panel used to Promise.all over every picked markdown
    // file, which on the reference archive is ~1409 reads started in one tick —
    // and a smaller subset of the same folder imports fine, which is what
    // pins the count as the thing that decides.
    let inflight = 0;
    let peak = 0;
    const files = Array.from({ length: READ_CONCURRENCY * 5 }, (_, i) =>
      fakeFile(`bulk-${i}.md`, async () => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 1));
        inflight--;
        return 'body';
      }),
    );

    const { read } = await readTextFiles(files);

    expect(read).toHaveLength(files.length);
    expect(peak).toEqual(READ_CONCURRENCY);
  });

  it('reports progress from 0 through to the total, so a long read is visible', async () => {
    const seen: [number, number][] = [];
    await readTextFiles([reads('a.md'), reads('b.md')], (done, total) =>
      seen.push([done, total]),
    );
    // The leading 0/2 is what the panel shows the instant the folder is
    // picked; without it the user sees the input's file count and nothing else.
    expect(seen[0]).toEqual([0, 2]);
    expect(seen.at(-1)).toEqual([2, 2]);
  });
});

describe('circuit breaker', () => {
  const unreadable = (name: string) =>
    ({
      name,
      webkitRelativePath: '',
      text: () => Promise.reject(new DOMException('nope', 'NotReadableError')),
    }) as unknown as File;

  const readable = (name: string) =>
    ({ name, webkitRelativePath: '', text: () => Promise.resolve('body') }) as unknown as File;

  it('stops attempting reads once a run of them has failed', async () => {
    // The live failure mode: the environment refuses every read. Grinding
    // through 1409 files, each with its retries and backoff, costs minutes
    // before the user is told anything.
    const files = Array.from({ length: 500 }, (_, i) => unreadable(`f${i}.md`));
    const result = await readTextFiles(files);

    expect(result.stoppedEarly).toBe(true);
    expect(result.failed.length).toBeLessThan(100);
    expect(result.skipped).toBeGreaterThan(300);
    expect(result.failed.length + result.skipped).toEqual(500);
  });

  it('does not trip on scattered failures among successes', async () => {
    // One unreadable file in every ten is bad luck, not a systemic refusal,
    // and must still cost the user only those files.
    const files = Array.from({ length: 200 }, (_, i) =>
      i % 10 === 0 ? unreadable(`bad${i}.md`) : readable(`ok${i}.md`),
    );
    const result = await readTextFiles(files);

    expect(result.stoppedEarly).toBe(false);
    expect(result.skipped).toEqual(0);
    expect(result.read).toHaveLength(180);
    expect(result.failed).toHaveLength(20);
  });
});
