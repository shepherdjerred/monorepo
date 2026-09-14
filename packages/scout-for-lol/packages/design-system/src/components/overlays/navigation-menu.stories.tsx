import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu.tsx";

const meta = {
  title: "Components/Overlays/NavigationMenu",
  component: NavigationMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof NavigationMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

type NavLinkItem = { readonly href: string; readonly label: string };

function NavLinkList(props: { links: readonly NavLinkItem[] }) {
  return (
    <ul className="scout-stack">
      {props.links.map((link) => (
        <li key={link.href}>
          <NavigationMenuLink href={link.href}>{link.label}</NavigationMenuLink>
        </li>
      ))}
    </ul>
  );
}

const reportLinks = [
  { href: "#weekly-ranked", label: "Weekly ranked recap" },
  { href: "#champion-trends", label: "Champion trends" },
  { href: "#custom-games", label: "Custom game scoreboards" },
] as const;

const bettingLinks = [
  { href: "#open-dares", label: "Open dares" },
  { href: "#leaderboard", label: "Bryan Bucks leaderboard" },
] as const;

function ControlledNavigationMenu() {
  const [value, setValue] = useState("");
  return (
    <div className="scout-stack">
      <NavigationMenu
        aria-label="Scout sections"
        value={value}
        onValueChange={setValue}
      >
        <NavigationMenuList>
          <NavigationMenuItem value="reports">
            <NavigationMenuTrigger>Reports</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavLinkList links={reportLinks} />
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="betting">
            <NavigationMenuTrigger>Bryan Bucks</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavLinkList links={bettingLinks} />
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
      <p className="scout-muted">
        {value === ""
          ? "No section expanded."
          : `The ${value} section is expanded.`}
      </p>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: () => (
    <NavigationMenu aria-label="Scout sections">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Reports</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavLinkList links={reportLinks} />
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#subscriptions">
            Subscriptions
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const LinksOnly: Story = {
  args: {},
  render: () => (
    <NavigationMenu aria-label="Guild navigation">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink href="#overview">Overview</NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#matches">Matches</NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#players" active>
            Players
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const Vertical: Story = {
  args: {},
  render: () => (
    <NavigationMenu aria-label="Report library" orientation="vertical">
      <NavigationMenuList className="scout-stack">
        <NavigationMenuItem>
          <NavigationMenuTrigger>Ranked</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavLinkList links={reportLinks} />
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Betting</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavLinkList links={bettingLinks} />
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const Controlled: Story = {
  args: {},
  render: () => <ControlledNavigationMenu />,
};
