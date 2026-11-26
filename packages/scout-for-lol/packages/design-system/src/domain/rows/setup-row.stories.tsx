import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { SetupRow, type SetupItem } from "./setup-row.tsx";

const meta = {
  title: "Domain/SetupRow",
  component: SetupRow,
  tags: ["autodocs"],
  args: { title: "Summoner spells", items: [] },
  decorators: [
    (story) => <Panel style={{ maxWidth: "64rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof SetupRow>;

export default meta;

type Story = StoryObj<typeof meta>;

const runes: SetupItem[] = [
  {
    label: "Electrocute",
    asset: { kind: "rune", key: "Electrocute" },
    keystone: true,
  },
  { label: "Cheap Shot", asset: { kind: "rune", key: "CheapShot" } },
  { label: "Sixth Sense", asset: { kind: "rune", key: "SixthSense" } },
  {
    label: "Ultimate Hunter",
    asset: { kind: "rune", key: "UltimateHunter" },
    breakAfter: true,
  },
  { label: "Manaflow Band", asset: { kind: "rune", key: "ManaflowBand" } },
  { label: "Transcendence", asset: { kind: "rune", key: "Transcendence" } },
];

const spells: SetupItem[] = [
  { label: "Flash", asset: { kind: "spell", key: "SummonerFlash" } },
  { label: "Ignite", asset: { kind: "spell", key: "SummonerDot" } },
];

const start: SetupItem[] = [
  { label: "Doran's Ring", asset: { kind: "item", key: 1056 } },
  { label: "2 Health Potions", asset: { kind: "item", key: 2003 } },
];

const build: SetupItem[] = [
  { label: "Malignance first", asset: { kind: "item", key: 3118 } },
  { label: "then Shadowflame", asset: { kind: "item", key: 4645 } },
  { label: "then Rabadon's Deathcap", asset: { kind: "item", key: 3089 } },
];

const skills: SetupItem[] = [
  { label: "Q first", asset: { kind: "ability", key: "Ahri-Q" } },
  { label: "then W", asset: { kind: "ability", key: "Ahri-W" } },
  { label: "then E", asset: { kind: "ability", key: "Ahri-E" } },
];

export const Runes: Story = {
  args: {
    title: "Runes",
    items: runes,
    note: "Domination, with Sorcery second",
    proof: { winRate: 52.6, games: 7840 },
  },
};

export const SummonerSpells: Story = {
  args: { items: spells, proof: { winRate: 52.1, games: 9900 } },
};

export const WithPickRate: Story = {
  args: {
    title: "Starting items",
    items: start,
    proof: { winRate: 52, games: 11_300, pickRate: 61.4 },
  },
};

export const Sequence: Story = {
  args: {
    title: "Core build",
    items: build,
    sequence: true,
    proof: { winRate: 53.4, games: 6210 },
  },
};

export const NoProof: Story = {
  args: { title: "Skill order", items: skills, sequence: true },
};

export const SmallSample: Story = {
  args: {
    title: "Core build",
    items: build.slice(0, 1),
    proof: { winRate: 60, games: 1 },
  },
};

export const FullSetup: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div>
      <SetupRow
        title="Runes"
        items={runes}
        note="Domination, with Sorcery second"
        proof={{ winRate: 52.6, games: 7840 }}
      />
      <SetupRow
        title="Summoner spells"
        items={spells}
        proof={{ winRate: 52.1, games: 9900 }}
      />
      <SetupRow
        title="Starting items"
        items={start}
        proof={{ winRate: 52, games: 11_300 }}
      />
      <SetupRow
        title="Skill order"
        items={skills}
        sequence
        proof={{ winRate: 52.8, games: 8120 }}
      />
      <SetupRow
        title="Core build"
        items={build}
        sequence
        proof={{ winRate: 53.4, games: 6210 }}
      />
    </div>
  ),
};
