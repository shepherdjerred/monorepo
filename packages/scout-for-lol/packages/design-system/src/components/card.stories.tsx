import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card.tsx";
import { Separator } from "./separator.tsx";

const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "unused" },
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Weekly report</CardTitle>
      </CardHeader>
      <CardContent>
        Twelve ranked games recorded for Bel&apos;Veth Enjoyer#NA1.
      </CardContent>
    </Card>
  ),
};

export const WithDescription: Story = {
  args: { children: "unused" },
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Ranked solo queue</CardTitle>
        <CardDescription>
          Season 15 · updated 4 minutes ago from the Riot match API
        </CardDescription>
      </CardHeader>
      <CardContent>
        Emerald II, 47 LP. 6W · 4L across the last ten games.
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  args: { children: "unused" },
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Report subscription</CardTitle>
        <CardDescription>
          Posts to #scout-reports in the Rift Wardens guild
        </CardDescription>
      </CardHeader>
      <CardContent>
        Triggered after every ranked solo queue game for three tracked
        summoners.
      </CardContent>
      <CardFooter>
        <Button size="sm">Edit subscription</Button>
        <Button size="sm" variant="outline">
          Send test report
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const ContentOnly: Story = {
  args: { children: "unused" },
  render: () => (
    <Card>
      <CardContent>
        No matches recorded yet. Scout will post here after the next ranked
        game.
      </CardContent>
    </Card>
  ),
};

export const MatchSummary: Story = {
  args: { children: "unused" },
  render: () => (
    <Card>
      <CardHeader
        style={{
          gridAutoFlow: "column",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        <CardTitle>Victory · Summoner&apos;s Rift</CardTitle>
        <Badge variant="secondary">32:14</Badge>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0 }}>
          Ahri · 11 / 3 / 14 · 241 CS · 28.4k damage to champions
        </p>
        <Separator style={{ marginBlock: "0.75rem" }} />
        <p style={{ margin: 0 }}>
          Ocean soul secured at 27:10. Baron taken at 29:40.
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm" variant="ghost">
          View full match
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const Grid: Story = {
  args: { children: "unused" },
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Tracked summoners</CardTitle>
          <CardDescription>Across 3 Discord guilds</CardDescription>
        </CardHeader>
        <CardContent>14</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reports this week</CardTitle>
          <CardDescription>Delivered to Discord</CardDescription>
        </CardHeader>
        <CardContent>128</CardContent>
      </Card>
    </div>
  ),
};
