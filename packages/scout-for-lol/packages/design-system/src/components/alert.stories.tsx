import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./alert.tsx";

const meta = {
  title: "Components/Alert",
  component: Alert,
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Informational: Story = {
  args: {
    tone: "info",
    children: (
      <>
        <AlertTitle>Match ingestion in progress</AlertTitle>
        <AlertDescription>
          Scout is backfilling the last 90 days of ranked games for this guild.
        </AlertDescription>
      </>
    ),
  },
};

export const Success: Story = {
  args: {
    tone: "success",
    children: (
      <>
        <AlertTitle>Subscription created</AlertTitle>
        <AlertDescription>
          Reports for Faker#KR1 will post to #scout-reports after each ranked
          game.
        </AlertDescription>
      </>
    ),
  },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    children: (
      <>
        <AlertTitle>Riot API rate limit approaching</AlertTitle>
        <AlertDescription>
          Report generation may lag by a few minutes until the window resets.
        </AlertDescription>
      </>
    ),
  },
};

export const Danger: Story = {
  args: {
    tone: "danger",
    children: (
      <>
        <AlertTitle>Riot account unlinked</AlertTitle>
        <AlertDescription>
          Scout can no longer read match history for this summoner. Re-link the
          account to resume reports.
        </AlertDescription>
      </>
    ),
  },
};

export const WithIcon: Story = {
  args: {
    tone: "info",
    icon: <Info size={18} />,
    children: (
      <>
        <AlertTitle>Patch 15.4 is live</AlertTitle>
        <AlertDescription>
          Champion statistics reset for the new patch. Trends rebuild after ~200
          recorded games.
        </AlertDescription>
      </>
    ),
  },
};

export const DescriptionOnly: Story = {
  args: {
    tone: "info",
    children: (
      <AlertDescription>
        No ranked games recorded for this summoner in the selected season.
      </AlertDescription>
    ),
  },
};

export const AllTones: Story = {
  args: { children: "unused" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Alert tone="info" icon={<Info size={18} />}>
        <AlertTitle>Queue snapshot</AlertTitle>
        <AlertDescription>14 summoners tracked in this guild.</AlertDescription>
      </Alert>
      <Alert tone="success" icon={<CircleCheck size={18} />}>
        <AlertTitle>Report delivered</AlertTitle>
        <AlertDescription>Posted to #scout-reports 2m ago.</AlertDescription>
      </Alert>
      <Alert tone="warning" icon={<TriangleAlert size={18} />}>
        <AlertTitle>Channel permissions missing</AlertTitle>
        <AlertDescription>
          Scout cannot attach images in #match-history.
        </AlertDescription>
      </Alert>
      <Alert tone="danger" icon={<CircleAlert size={18} />}>
        <AlertTitle>Ingestion failed</AlertTitle>
        <AlertDescription>
          Riot match API returned 503 for NA1_5210448831.
        </AlertDescription>
      </Alert>
    </div>
  ),
};
