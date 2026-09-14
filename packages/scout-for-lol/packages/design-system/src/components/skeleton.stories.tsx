import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardContent, CardHeader } from "./card.tsx";
import { Skeleton } from "./skeleton.tsx";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

// `.scout-skeleton` paints a shimmer but has no intrinsic size, so every
// placeholder below states its own dimensions.
const stack = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
} as const;

const circle = (size: string) =>
  ({ width: size, height: size, borderRadius: "50%" }) as const;

export const Default: Story = {
  args: { style: { height: "1rem", width: "12rem" } },
};

export const TextLines: Story = {
  args: {},
  render: () => (
    <div style={stack}>
      <Skeleton style={{ height: "1rem", width: "16rem" }} />
      <Skeleton style={{ height: "1rem", width: "14rem" }} />
      <Skeleton style={{ height: "1rem", width: "10rem" }} />
    </div>
  ),
};

export const Avatar: Story = {
  args: {},
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Skeleton style={circle("3rem")} />
      <div style={stack}>
        <Skeleton style={{ height: "1rem", width: "10rem" }} />
        <Skeleton style={{ height: "0.75rem", width: "6rem" }} />
      </div>
    </div>
  ),
};

export const MatchCard: Story = {
  args: {},
  render: () => (
    <Card role="status" aria-busy="true" aria-label="Loading match report">
      <CardHeader
        style={{
          gridAutoFlow: "column",
          justifyContent: "start",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <Skeleton style={circle("2.5rem")} />
        <Skeleton style={{ height: "1.25rem", width: "12rem" }} />
      </CardHeader>
      <CardContent style={stack}>
        <Skeleton style={{ height: "1rem", width: "100%" }} />
        <Skeleton style={{ height: "1rem", width: "83%" }} />
        <Skeleton style={{ height: "1rem", width: "66%" }} />
      </CardContent>
    </Card>
  ),
};

export const MatchHistoryList: Story = {
  args: {},
  render: () => (
    <div role="status" aria-busy="true" aria-label="Loading match history">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Skeleton style={{ height: "3.5rem", width: "100%" }} />
        <Skeleton style={{ height: "3.5rem", width: "100%" }} />
        <Skeleton style={{ height: "3.5rem", width: "100%" }} />
        <Skeleton style={{ height: "3.5rem", width: "100%" }} />
      </div>
    </div>
  ),
};
