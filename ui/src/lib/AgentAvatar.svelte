<script lang="ts">
  import { getContext } from 'svelte';
  import type { AgentPubKey } from '@holochain/client';
  import type { ProfilesClient } from '@holochain-open-dev/profiles';
  import renderIdenticon from '@holo-host/identicon';
  import { weaveContext } from '../contexts';
  import { avatarSource, type ProfileLike } from '../avatar/source';
  import { cachedAgentProfile } from '../avatar/profile-cache';

  // Renders a person, never a hash: their Moss profile avatar when one is
  // set, otherwise an identicon derived from their agent key. Outside Moss
  // (hc-spin dev, the e2e harness) there is no profiles client at all, so
  // every agent renders as an identicon — that path must not warn or leave a
  // blank space. See docs/dev/fix-brief-template.md and the Task A dispatch
  // for the full behaviour table.
  let { agent, size = 24 }: { agent: AgentPubKey; size?: number } = $props();

  const weave = getContext<{ profilesClient?: ProfilesClient } | undefined>(weaveContext);

  let profile = $state<ProfileLike | undefined>(undefined);
  let canvas = $state<HTMLCanvasElement | undefined>();

  $effect(() => {
    const client = weave?.profilesClient;
    const forAgent = agent;
    if (!client) {
      profile = undefined;
      return;
    }
    let cancelled = false;
    cachedAgentProfile(client, forAgent).then((entry) => {
      if (!cancelled) profile = entry;
    });
    return () => {
      cancelled = true;
    };
  });

  let source = $derived(avatarSource(profile));

  $effect(() => {
    if (source.kind === 'identicon' && canvas) {
      renderIdenticon({ hash: agent, size }, canvas);
    }
  });
</script>

{#if source.kind === 'avatar'}
  <img
    class="agent-avatar"
    style="width: {size}px; height: {size}px;"
    src={source.url}
    alt={profile?.nickname ?? 'Avatar'}
    title={profile?.nickname}
  />
{:else}
  <canvas
    bind:this={canvas}
    class="agent-avatar identicon"
    width={size}
    height={size}
    style="width: {size}px; height: {size}px;"
    title={profile?.nickname}
  ></canvas>
{/if}

<style>
  .agent-avatar { border-radius: 50%; display: inline-block; vertical-align: middle; flex-shrink: 0; }
</style>
