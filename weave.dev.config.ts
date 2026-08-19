import { defineConfig } from '@theweave/cli';

export default defineConfig({
  toolCurations: [],
  groups: [
    {
      name: 'Community',
      networkSeed: 'ark-dev-seed-0001',
      icon: { type: 'filesystem', path: './ui/icon.png' },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: { nickname: 'Alice', avatar: { type: 'filesystem', path: './ui/icon.png' } },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: { nickname: 'Bob', avatar: { type: 'filesystem', path: './ui/icon.png' } },
        },
      ],
      applets: [
        { name: 'ark', instanceName: 'ark', registeringAgent: 1, joiningAgents: [2] },
      ],
    },
  ],
  applets: [
    {
      name: 'ark',
      subtitle: 'text archive',
      description: 'Archive, amend and search a community’s documents.',
      icon: { type: 'filesystem', path: './ui/icon.png' },
      source: { type: 'localhost', happPath: './workdir/ark.happ', uiPort: 8888 },
    },
  ],
});
