import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "./panel.tsx";

const meta = {
  title: "Components/Panel",
  component: Panel,
  tags: ["autodocs"],
} satisfies Meta<typeof Panel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: "panel",
    children: (
      <>
        <h2 style={{ margin: 0 }}>Last ten games</h2>
        <p className="scout-muted">7 wins, 3 losses</p>
      </>
    ),
  },
};

export const Open: Story = {
  args: {
    variant: "open",
    children: (
      <>
        <h2 style={{ margin: 0 }}>Recent games</h2>
        <p className="scout-muted">No surface, only the padding.</p>
      </>
    ),
  },
};

export const Hero: Story = {
  args: {
    variant: "hero",
    children: (
      <div style={{ padding: "2.25rem 2.75rem" }}>
        <h1 style={{ margin: 0 }}>Bearded Lyfe</h1>
        <p className="scout-muted">Emerald II · 62 LP</p>
      </div>
    ),
  },
};

export const OnTheGround: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "grid", gap: "1.5rem", maxWidth: "40rem" }}>
      <Panel variant="hero">
        <div style={{ padding: "2rem 2.5rem" }}>
          <h1 style={{ margin: 0 }}>Hero</h1>
        </div>
      </Panel>
      <Panel>
        <h2 style={{ margin: 0 }}>Panel</h2>
      </Panel>
      <Panel variant="open">
        <h2 style={{ margin: 0 }}>Open</h2>
      </Panel>
    </div>
  ),
};

export const AsSection: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Panel asChild>
      <section aria-labelledby="panel-as-section">
        <h2 id="panel-as-section" style={{ margin: 0 }}>
          Rendered as a section
        </h2>
      </section>
    </Panel>
  ),
};
