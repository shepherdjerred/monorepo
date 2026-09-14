import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Badge } from "./badge.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.tsx";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { defaultValue: "overview" },
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList aria-label="Match report sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        Victory on Summoner&apos;s Rift in 32:14. Ahri went 11 / 3 / 14 with 241
        CS.
      </TabsContent>
      <TabsContent value="details">
        28,412 damage to champions, 34 vision score, 4 dragons and 2 Barons
        secured by the blue team.
      </TabsContent>
      <TabsContent value="timeline">
        08:12 Rift Herald · 14:30 Infernal Drake · 27:10 Ocean soul · 29:40
        Baron Nashor.
      </TabsContent>
    </Tabs>
  ),
};

export const Vertical: Story = {
  args: { defaultValue: "solo" },
  render: () => (
    <Tabs defaultValue="solo" orientation="vertical">
      <TabsList aria-label="Queue types">
        <TabsTrigger value="solo">Ranked Solo</TabsTrigger>
        <TabsTrigger value="flex">Ranked Flex</TabsTrigger>
        <TabsTrigger value="aram">ARAM</TabsTrigger>
      </TabsList>
      <TabsContent value="solo">Emerald II · 47 LP · 6W / 4L</TabsContent>
      <TabsContent value="flex">Platinum IV · 12 LP · 3W / 5L</TabsContent>
      <TabsContent value="aram">38 games this patch · 62% win rate</TabsContent>
    </Tabs>
  ),
};

export const WithDisabledTab: Story = {
  args: { defaultValue: "matches" },
  render: () => (
    <Tabs defaultValue="matches">
      <TabsList aria-label="Summoner profile sections">
        <TabsTrigger value="matches">Match history</TabsTrigger>
        <TabsTrigger value="champions">Champions</TabsTrigger>
        <TabsTrigger value="mastery" disabled>
          Mastery
        </TabsTrigger>
      </TabsList>
      <TabsContent value="matches">
        Last 20 ranked games ingested from the Riot match API.
      </TabsContent>
      <TabsContent value="champions">
        Ahri, Syndra and Orianna account for 74% of games played this season.
      </TabsContent>
      <TabsContent value="mastery">
        Link a Riot account to unlock champion mastery.
      </TabsContent>
    </Tabs>
  ),
};

function GuildTabsFrame() {
  const [value, setValue] = useState("reports");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList aria-label="Rift Wardens guild sections">
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
      </TabsList>
      <TabsContent value="reports">
        <p style={{ margin: 0 }}>
          128 reports delivered this week <Badge variant="secondary">#1</Badge>
        </p>
      </TabsContent>
      <TabsContent value="subscriptions">
        3 active subscriptions posting to #scout-reports and #match-history.
      </TabsContent>
      <TabsContent value="members">
        14 tracked summoners across NA1 and EUW.
      </TabsContent>
    </Tabs>
  );
}

export const Controlled: Story = {
  args: {},
  render: () => <GuildTabsFrame />,
};

export const TwoTabs: Story = {
  args: { defaultValue: "blue" },
  render: () => (
    <Tabs defaultValue="blue">
      <TabsList aria-label="Team scoreboards">
        <TabsTrigger value="blue">Blue team</TabsTrigger>
        <TabsTrigger value="red">Red team</TabsTrigger>
      </TabsList>
      <TabsContent value="blue">
        Ahri, Lee Sin, Thresh, Jinx, Ornn — 9 turrets, 2 Barons.
      </TabsContent>
      <TabsContent value="red">
        Viktor, Vi, Nautilus, Caitlyn, Renekton — 3 turrets, 0 Barons.
      </TabsContent>
    </Tabs>
  ),
};
