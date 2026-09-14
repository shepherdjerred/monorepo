import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button.tsx";
import { Card, CardContent } from "./card.tsx";
import { Spinner } from "./spinner.tsx";

const meta = {
  title: "Components/Spinner",
  component: Spinner,
  tags: ["autodocs"],
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

// `.scout-spinner` ships a 1.25rem ring; these stories override the box size
// directly because there are no size variants on the component.
const row = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
} as const;

export const Default: Story = { args: {} };

export const WithLabel: Story = {
  args: { "aria-label": "Generating report" },
  render: (args) => (
    <div style={row}>
      <Spinner {...args} />
      <span>Generating match report…</span>
    </div>
  ),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
      <Spinner
        aria-label="Small spinner"
        style={{ width: "1rem", height: "1rem" }}
      />
      <Spinner
        aria-label="Medium spinner"
        style={{ width: "1.5rem", height: "1.5rem" }}
      />
      <Spinner
        aria-label="Large spinner"
        style={{ width: "2.25rem", height: "2.25rem", borderWidth: "3px" }}
      />
    </div>
  ),
};

export const InButton: Story = {
  args: {
    "aria-label": "Syncing",
    style: { width: "1rem", height: "1rem" },
  },
  render: (args) => (
    <Button disabled>
      <Spinner {...args} />
      Syncing match history
    </Button>
  ),
};

export const InCard: Story = {
  args: { "aria-label": "Loading ranked ladder" },
  render: (args) => (
    <Card>
      <CardContent style={row}>
        <Spinner {...args} />
        <span>Loading ranked ladder for Rift Wardens…</span>
      </CardContent>
    </Card>
  ),
};
