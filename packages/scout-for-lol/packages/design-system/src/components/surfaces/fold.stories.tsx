import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fold } from "./fold.tsx";

const meta = {
  title: "Components/Fold",
  component: Fold,
  tags: ["autodocs"],
  args: {
    summary: "Other accounts",
    children: <p className="scout-muted">Two linked accounts.</p>,
  },
} satisfies Meta<typeof Fold>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  args: {
    summary: "More stats",
    defaultOpen: true,
    children: (
      <ul className="scout-stack">
        <li>Damage per minute: 612</li>
        <li>Vision score per game: 31</li>
        <li>Gold at 15 minutes: 5,420</li>
      </ul>
    ),
  },
};

export const Group: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem" }}>
      <Fold summary="Rune pages">
        <p className="scout-muted">
          Electrocute, Sudden Impact, Eyeball Collection.
        </p>
      </Fold>
      <Fold summary="Item order" defaultOpen>
        <p className="scout-muted">
          Hextech Rocketbelt, Shadowflame, Rabadon&apos;s.
        </p>
      </Fold>
      <Fold summary="Skill order">
        <p className="scout-muted">Q, W, E, then Q to max.</p>
      </Fold>
    </div>
  ),
};
