import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "#src/components/button.tsx";
import {
  ErrorState,
  LoadingState,
  PermissionState,
  StaleState,
} from "./states.tsx";

const meta = {
  title: "Domain/States",
  component: LoadingState,
  tags: ["autodocs"],
} satisfies Meta<typeof LoadingState>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story args need a handler; the story frame owns the real state.
}

export const Loading: Story = { args: {} };

export const LoadingWithLabel: Story = {
  args: { label: "Rebuilding the report lake from S3…" },
};

export const Error: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ErrorState message="Riot returned 503 while fetching the last five Ranked Solo/Duo matches." />
  ),
};

export const ErrorWithRetry: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ErrorState
      title="Match ingest failed"
      message="Riot returned 503 while fetching NA1_5182340011. Nothing was written to the report lake."
      onRetry={noop}
    />
  ),
};

export const Permission: Story = {
  parameters: { controls: { disable: true } },
  render: () => <PermissionState />,
};

export const PermissionWithAction: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <PermissionState
      message="Managing subscriptions for the Bearded Lyfe guild needs the Manage Server permission in Discord."
      action={<Button>Switch guild</Button>}
    />
  ),
};

export const Stale: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <StaleState
      errors={[
        {
          path: ["subscriptions", "ranked-solo"],
          error: "Riot API returned 503",
        },
      ]}
    />
  ),
};
