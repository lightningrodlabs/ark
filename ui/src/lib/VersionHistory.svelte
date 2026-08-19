<script lang="ts">
  import { diffWords } from 'diff';
  import { encodeHashToBase64 } from '@holochain/client';
  import type { DocumentVersion } from '../types';
  import AgentAvatar from './AgentAvatar.svelte';

  // `currentAction` is the resolved latest from DocumentSummary.latest. The
  // current version is identified by hash, never by position in the list —
  // clock skew across agents means "last" and "current" are not the same claim.
  let {
    versions,
    currentAction,
  }: { versions: DocumentVersion[]; currentAction: string } = $props();

  let expanded = $state<string | null>(null);

  function diffAgainstPrevious(index: number) {
    const previous = index > 0 ? versions[index - 1].body : '';
    return diffWords(previous, versions[index].body);
  }
</script>

<section class="history">
  <h3>Versions</h3>
  <ol>
    {#each versions as version, i (encodeHashToBase64(version.action))}
      {@const id = encodeHashToBase64(version.action)}
      <li>
        <button onclick={() => (expanded = expanded === id ? null : id)}>
          v{i + 1} · {new Date(version.timestamp / 1000).toLocaleString()} ·
          <AgentAvatar agent={version.author} size={18} />
          {#if id === currentAction}<em>current</em>{/if}
        </button>
        {#if expanded === id}
          <pre class="diff">{#each diffAgainstPrevious(i) as part}<span
              class:added={part.added}
              class:removed={part.removed}>{part.value}</span>{/each}</pre>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .history { border-top: 1px solid rgba(128, 128, 128, 0.3); margin-top: 1rem; }
  ol { list-style: none; padding: 0; }
  button { background: none; border: none; cursor: pointer; text-align: left; }
  .diff { white-space: pre-wrap; background: rgba(128, 128, 128, 0.08); padding: 0.5rem; }
  .added { background: rgba(0, 160, 0, 0.2); }
  .removed { background: rgba(200, 0, 0, 0.2); text-decoration: line-through; }
</style>
