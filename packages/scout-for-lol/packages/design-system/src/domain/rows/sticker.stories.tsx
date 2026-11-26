import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sticker } from "./sticker.tsx";

const meta = {
  title: "Domain/Sticker",
  component: Sticker,
  tags: ["autodocs"],
  args: {
    title: "Biggest climb",
    detail: "Northstar, +63 LP",
    who: { person: "Northstar", you: true },
    href: "#award",
  },
} satisfies Meta<typeof Sticker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Person: Story = {};

export const Champion: Story = {
  args: {
    title: "Most played champion",
    detail: "Yasuo, 14 games",
    who: { champion: "Yasuo" },
  },
};

export const LongText: Story = {
  args: {
    title: "Longest win streak of the whole week",
    detail: "A friend with a very long summoner name, 6 wins in a row",
    who: { person: "A friend with a very long summoner name" },
  },
  decorators: [(story) => <div style={{ maxWidth: "22rem" }}>{story()}</div>],
};

export const NotALink: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Sticker
      title="Biggest climb"
      detail="Northstar, +63 LP"
      who={{ person: "Northstar" }}
    />
  ),
};

export const Awards: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "0.625rem",
        justifyItems: "start",
      }}
    >
      <Sticker
        title="Biggest climb"
        detail="Northstar, +63 LP"
        who={{ person: "Northstar", you: true }}
        href="#a"
      />
      <Sticker
        title="Most games"
        detail="TidalWren, 23 games"
        who={{ person: "TidalWren" }}
        href="#b"
      />
      <Sticker
        title="Longest streak"
        detail="Oakheart, 6 wins in a row"
        who={{ person: "Oakheart" }}
        href="#c"
      />
      <Sticker
        title="Most played champion"
        detail="Yasuo, 14 games"
        who={{ champion: "Yasuo" }}
        href="#d"
      />
    </div>
  ),
};
