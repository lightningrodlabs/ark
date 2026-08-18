import { describe, expect, it } from 'vitest';
import { runScenario } from '@holochain-open-dev/tryorama';
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import { appSource, call } from '../common.js';

describe('ark happ', () => {
  it('installs and answers a zome call', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const key = await call<AgentPubKey>(alice, 'whoami', null);
      expect(encodeHashToBase64(key)).toEqual(encodeHashToBase64(alice.agentPubKey));
    });
  });
});
