import { encodeHashToBase64, type AgentPubKey } from '@holochain/client';
import type { ProfilesClient } from '@holochain-open-dev/profiles';
import type { ProfileLike } from './source';

/**
 * Fetched profiles, shared across every `AgentAvatar` instance for the life of
 * the tab. A document's version history and the author filter row each render
 * an avatar per entry, so the same person's profile would otherwise be
 * fetched once per rendered instance instead of once per session.
 *
 * Module-level by design — there is one profiles client per session (Moss
 * hands out one `weaveClient.renderInfo.profilesClient` for the whole
 * applet), so a single cache keyed by agent is enough; it is never cleared
 * except by tests.
 */
const cache = new Map<string, Promise<ProfileLike | undefined>>();

/** Test-only: start each test with an empty cache. */
export function clearProfileCache(): void {
  cache.clear();
}

/**
 * Fetches an agent's profile through the module-level cache, deduping both
 * repeat calls and concurrent in-flight calls for the same agent.
 *
 * A fetch that *fails* (network error, etc.) is deliberately not cached: an
 * agent with a real profile must not be pinned to "no profile" for the rest
 * of the session just because one request hit a transient error. A fetch
 * that *succeeds* with no profile set is cached as `undefined` — that is a
 * real answer, not a failure.
 */
export function cachedAgentProfile(
  client: ProfilesClient,
  agent: AgentPubKey,
): Promise<ProfileLike | undefined> {
  const k = encodeHashToBase64(agent);
  const cached = cache.get(k);
  if (cached) return cached;

  const promise = client
    .getAgentProfile(agent)
    .then((record) => record?.entry)
    .catch(() => {
      cache.delete(k);
      return undefined;
    });
  cache.set(k, promise);
  return promise;
}
