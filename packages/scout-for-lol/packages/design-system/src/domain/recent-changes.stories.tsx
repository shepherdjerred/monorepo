import type { Meta, StoryObj } from "@storybook/react-vite";
import { getRecentChampionChanges } from "@scout-for-lol/data/data-dragon/patch-changes.ts";
import { RecentChanges } from "./recent-changes.tsx";

// Real entries from the generated patch notes (26.14 to 26.23). The win rates
// below are sample figures: the weekly pipeline that supplies them is not built.
const ANNIE = 1;
const KAYLE = 10;
const LEBLANC = 7;
const NASUS = 75;
const NUNU = 20;
const QIYANA = 246;
const DORANS_BOW = 1086;
const OVERLORDS_BLOODMAIL = 2501;

const now = new Date("2026-11-27T12:00:00Z");

const meta = {
  title: "Domain/RecentChanges",
  component: RecentChanges,
  tags: ["autodocs"],
  args: {
    championId: NUNU,
    patches: getRecentChampionChanges({ championId: NUNU, patches: 10 }),
    now,
  },
  decorators: [
    (story) => (
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>{story()}</div>
    ),
  ],
} satisfies Meta<typeof RecentChanges>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Buffed: Story = {};

export const Nerfed: Story = {
  args: {
    championId: NASUS,
    patches: getRecentChampionChanges({ championId: NASUS, patches: 5 }),
  },
};

/** A champion buff beside an item nerf: each row has its own mark. */
export const MixedDirections: Story = {
  args: {
    championId: KAYLE,
    patches: getRecentChampionChanges({
      championId: KAYLE,
      patches: 10,
      itemIds: [DORANS_BOW, OVERLORDS_BLOODMAIL],
    }),
    allChangesHref: "#",
  },
};

/** Buffs and nerfs to the champion herself, base stats and the Mimic recast. */
export const MixedWithinTheChampion: Story = {
  args: {
    championId: LEBLANC,
    patches: getRecentChampionChanges({ championId: LEBLANC, patches: 10 }),
  },
};

export const LongNamesAndValues: Story = {
  args: {
    championId: QIYANA,
    patches: getRecentChampionChanges({ championId: QIYANA, patches: 10 }),
  },
  decorators: [
    (story) => (
      <div style={{ maxWidth: "26rem", margin: "0 auto" }}>{story()}</div>
    ),
  ],
};

export const LongValues: Story = {
  args: {
    championId: ANNIE,
    patches: getRecentChampionChanges({ championId: ANNIE, patches: 10 }),
  },
};

export const WithWinRates: Story = {
  args: {
    championId: KAYLE,
    patches: getRecentChampionChanges({ championId: KAYLE, patches: 10 }),
    winRates: {
      "26.22": {
        before: { winRate: 50.9, games: 11_900 },
        after: { winRate: 51.8, games: 12_480 },
      },
    },
  },
};

export const AbilityLabelSlot: Story = {
  args: {
    championId: QIYANA,
    patches: getRecentChampionChanges({ championId: QIYANA, patches: 5 }),
    renderAbilityLabel: ({ label }) => (
      <span style={{ textDecoration: "underline dotted" }}>{label}</span>
    ),
  },
};

export const Empty: Story = {
  args: {
    championId: NASUS,
    patches: getRecentChampionChanges({ championId: NASUS, patches: 3 }),
    windowPatches: 3,
  },
};

export const EmptyWithoutWindow: Story = {
  args: { championId: NASUS, patches: [] },
};
