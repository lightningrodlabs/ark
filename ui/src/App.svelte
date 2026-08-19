<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { AppWebsocket, type AppClient } from '@holochain/client';
  import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api';
  import { ArkClient } from './ark-client';
  import { clientContext } from './contexts';
  import { appletServices } from './we';

  let ark: ArkClient | undefined = $state();
  let error: string | undefined = $state();
  let documentCount: number | undefined = $state();

  setContext(clientContext, { get ark() { return ark; } });

  onMount(async () => {
    try {
      let client: AppClient;
      if (import.meta.env.DEV && !isWeaveContext()) {
        await initializeHotReload().catch(() => {});
      }
      if (isWeaveContext()) {
        const weaveClient = await WeaveClient.connect(appletServices);
        if (weaveClient.renderInfo.type !== 'applet-view') throw new Error('Unsupported view');
        client = weaveClient.renderInfo.appletClient;
      } else {
        client = await AppWebsocket.connect({ defaultTimeout: 240000 });
      }
      ark = new ArkClient(client);
      documentCount = (await ark.getAllDocuments(0, 1000)).length;
    } catch (e) {
      error = String(e);
    }
  });
</script>

<main>
  <h1>ark</h1>
  {#if error}
    <p class="error">{error}</p>
  {:else if documentCount === undefined}
    <p>Connecting…</p>
  {:else}
    <p>{documentCount} documents</p>
  {/if}
</main>
