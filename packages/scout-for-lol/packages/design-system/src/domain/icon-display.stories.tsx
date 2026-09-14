import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AugmentDisplay,
  ItemDisplay,
  LaneDisplay,
  RuneDisplay,
  SpellDisplay,
} from "./icon-display.tsx";

const meta = {
  title: "Domain/IconDisplay",
  component: ItemDisplay,
  tags: ["autodocs"],
} satisfies Meta<typeof ItemDisplay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Item: Story = {
  args: { item: 6672, label: "Kraken Slayer", detail: "Mythic · 3100g" },
};

export const FullBuild: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-grid">
      <ItemDisplay item={6672} label="Kraken Slayer" detail="Completed 14:20" />
      <ItemDisplay
        item={3006}
        label="Berserker's Greaves"
        detail="Completed 9:05"
      />
      <ItemDisplay item={3031} label="Infinity Edge" detail="Completed 21:47" />
      <ItemDisplay
        item={3036}
        label="Lord Dominik's Regards"
        detail="Completed 28:12"
      />
      <ItemDisplay
        item={3026}
        label="Guardian Angel"
        detail="Completed 33:58"
      />
      <ItemDisplay item={3364} label="Oracle Lens" detail="Trinket" />
    </div>
  ),
};

export const RunePage: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-grid">
      <RuneDisplay
        rune="PressTheAttack"
        label="Press the Attack"
        detail="Keystone · Precision"
      />
      <RuneDisplay rune="Triumph" label="Triumph" detail="Precision" />
      <RuneDisplay
        rune="LegendAlacrity"
        label="Legend: Alacrity"
        detail="Precision"
      />
      <RuneDisplay rune="CutDown" label="Cut Down" detail="Precision" />
      <RuneDisplay
        rune="SuddenImpact"
        label="Sudden Impact"
        detail="Domination"
      />
      <RuneDisplay
        rune="TreasureHunter"
        label="Treasure Hunter"
        detail="Domination"
      />
    </div>
  ),
};

export const SummonerSpells: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-cluster">
      <SpellDisplay spell="SummonerFlash" label="Flash" detail="D · 300s" />
      <SpellDisplay spell="SummonerDot" label="Ignite" detail="F · 180s" />
      <SpellDisplay spell="SummonerSmite" label="Smite" detail="Jungle" />
      <SpellDisplay
        spell="SummonerTeleport"
        label="Teleport"
        detail="Top lane"
      />
      <SpellDisplay spell="SummonerHeal" label="Heal" detail="Bot lane" />
      <SpellDisplay spell="SummonerExhaust" label="Exhaust" detail="Support" />
    </div>
  ),
};

export const ArenaAugments: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-grid">
      <AugmentDisplay
        augment="bladewaltz_large"
        label="Blade Waltz"
        detail="Prismatic · round 2-1"
      />
      <AugmentDisplay
        augment="jeweledgauntlet_large"
        label="Jeweled Gauntlet"
        detail="Gold · round 3-2"
      />
      <AugmentDisplay
        augment="celestialbody_large"
        label="Celestial Body"
        detail="Silver · round 4-2"
      />
      <AugmentDisplay
        augment="goliath_large"
        label="Goliath"
        detail="Prismatic · round 5-2"
      />
    </div>
  ),
};

export const Lanes: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-cluster">
      <LaneDisplay lane="top" label="Top" />
      <LaneDisplay lane="jungle" label="Jungle" />
      <LaneDisplay lane="middle" label="Mid" />
      <LaneDisplay lane="adc" label="Bot" />
      <LaneDisplay lane="support" label="Support" />
    </div>
  ),
};

export const MatchLoadout: Story = {
  args: { item: 6672, label: "Kraken Slayer" },
  render: () => (
    <div className="scout-stack">
      <LaneDisplay lane="adc" label="Bot · Ranked Solo/Duo" />
      <div className="scout-cluster">
        <SpellDisplay spell="SummonerFlash" label="Flash" />
        <SpellDisplay spell="SummonerHeal" label="Heal" />
        <RuneDisplay rune="LethalTempoTemp" label="Lethal Tempo" />
        <ItemDisplay item={3153} label="Blade of the Ruined King" />
        <ItemDisplay item={3094} label="Rapid Firecannon" />
      </div>
    </div>
  ),
};
