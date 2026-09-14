import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible.tsx";

const meta = {
  title: "Components/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  render: () => (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          Show build order
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            margin: "0.75rem 0 0",
            paddingLeft: "1.25rem",
          }}
        >
          <li>Doran&apos;s Ring · Health Potion</li>
          <li>Luden&apos;s Companion</li>
          <li>Sorcerer&apos;s Shoes</li>
          <li>Shadowflame</li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const DefaultOpen: Story = {
  args: {},
  render: () => (
    <Collapsible defaultOpen>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          Objective timeline
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            margin: "0.75rem 0 0",
            paddingLeft: "1.25rem",
          }}
        >
          <li>08:12 · Rift Herald · Blue team</li>
          <li>14:30 · Infernal Drake · Blue team</li>
          <li>29:40 · Baron Nashor · Blue team</li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  ),
};

function GuildRosterFrame() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>Rift Wardens roster</h3>
        <Badge variant="secondary">14 summoners</Badge>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {open ? "Hide roster" : "Show roster"}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            margin: "0.75rem 0 0",
            paddingLeft: "1.25rem",
          }}
        >
          <li>Bel&apos;Veth Enjoyer#NA1 · Emerald II</li>
          <li>Wardstone Andy#NA1 · Platinum IV</li>
          <li>Perma Flash#EUW · Diamond III</li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const Controlled: Story = {
  args: {},
  render: () => <GuildRosterFrame />,
};

export const Disabled: Story = {
  args: {},
  render: () => (
    <Collapsible disabled>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" disabled>
          Champion mastery (link a Riot account)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        Mastery details load once a Riot account is linked.
      </CollapsibleContent>
    </Collapsible>
  ),
};
