import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { TipList, type Tip, type TipReverse } from "./tip-list.tsx";

const meta = {
  title: "Domain/TipList",
  component: TipList,
  tags: ["autodocs"],
  args: { tips: [] },
  decorators: [
    (story) => <Panel style={{ maxWidth: "46rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof TipList>;

export default meta;

type Story = StoryObj<typeof meta>;

const tips: Tip[] = [
  {
    id: "q",
    text: "Syndra out-ranges you early. Give up a minion rather than take a free Dark Sphere.",
    icons: [
      { asset: { kind: "ability", key: "Syndra-Q" }, label: "Dark Sphere" },
    ],
  },
  {
    id: "e",
    text: "Her stun is her only defence. Bait it out, then Charm.",
    icons: [
      {
        asset: { kind: "ability", key: "Syndra-E" },
        label: "Scatter the Weak",
      },
      { asset: { kind: "ability", key: "Ahri-E" }, label: "Charm" },
    ],
  },
  {
    id: "r",
    text: "From level 6, dash sideways through her spheres; if she misses the stun, you win the fight.",
    icons: [
      { asset: { kind: "ability", key: "Ahri-R" }, label: "Spirit Rush" },
    ],
  },
];

const reverse: TipReverse = {
  title: "Playing Syndra into Ahri",
  champion: "Syndra",
  tips: [
    {
      id: "r1",
      text: "Poke with Dark Sphere whenever she walks up to last-hit.",
      icons: [
        { asset: { kind: "ability", key: "Syndra-Q" }, label: "Dark Sphere" },
      ],
    },
    {
      id: "r2",
      text: "Hold your stun for the moment she dashes in. Do not spend it on poke.",
      icons: [
        {
          asset: { kind: "ability", key: "Syndra-E" },
          label: "Scatter the Weak",
        },
        { asset: { kind: "ability", key: "Ahri-R" }, label: "Spirit Rush" },
      ],
    },
  ],
};

export const Default: Story = { args: { tips } };

export const WithReverse: Story = { args: { tips, reverse } };

export const WithoutIcons: Story = {
  args: {
    tips: [
      {
        id: "a",
        text: "Keep one Spirit Rush dash to get out, not only to get in.",
      },
      {
        id: "b",
        text: "After level 6, push the wave and visit a side lane; Ahri is one of the best roamers in mid.",
        icons: [{ asset: { kind: "lane", key: "middle" }, label: "Mid" }],
      },
    ],
  },
};

export const LongTip: Story = {
  args: {
    tips: [
      {
        id: "long",
        text: "Land Charm before you commit, because everything else hits harder on a charmed target, and then use the rest of the combo only if the wave is already pushed toward their tower, otherwise back off and wait for the next cooldown to come around.",
        icons: [{ asset: { kind: "ability", key: "Ahri-E" }, label: "Charm" }],
      },
    ],
    reverse: {
      ...reverse,
      tips: [
        {
          id: "long-reverse",
          text: "Poke with Dark Sphere whenever she walks up to last-hit, and keep doing it until she stops walking up, and then keep doing it some more from behind the wave.",
        },
      ],
    },
  },
};

export const Empty: Story = { args: { tips: [] } };
