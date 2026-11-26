import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { RichTooltip } from "#src/components/overlays/rich-tooltip.tsx";
import { Chip } from "#src/components/surfaces/chip.tsx";
import {
  TooltipScoutRow,
  TooltipScoutRows,
  TooltipTally,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import {
  failingLoader,
  fixtureLoader,
  scoutFor,
  stalledLoader,
} from "#src/domain/tooltips/entity-tooltip.fixtures.tsx";
import {
  GameFactTooltip,
  type EntityTooltipExtras,
} from "#src/domain/tooltips/entity-tooltip.tsx";
import { GameFactProvider } from "#src/domain/tooltips/game-fact.tsx";
import type { GameFactLoader } from "#src/domain/tooltips/game-fact-types.ts";
import { PlayerTooltip } from "#src/domain/tooltips/player-tooltip.tsx";

const meta = {
  title: "Domain/EntityTooltip",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** Room under the trigger for a tooltip, which floats over the page. */
function Stage(props: { loader?: GameFactLoader; children: ReactNode }) {
  return (
    <GameFactProvider loader={props.loader ?? fixtureLoader()}>
      <div
        style={{ minHeight: "46rem", padding: "2rem 1.5rem", display: "flex" }}
      >
        {props.children}
      </div>
    </GameFactProvider>
  );
}

const resolvePart: EntityTooltipExtras["resolvePart"] = (part) => ({
  scout: scoutFor(part.kind, part.key),
});

function Open(props: {
  kind: "champion" | "ability" | "item" | "rune" | "summoner-spell";
  factKey: string;
  label: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <GameFactTooltip
      kind={props.kind}
      factKey={props.factKey}
      label={props.label}
      scout={scoutFor(props.kind, props.factKey)}
      resolvePart={resolvePart}
      href={props.href}
      linkLabel={props.linkLabel}
      defaultOpen
    >
      <Chip variant="float">{props.label}</Chip>
    </GameFactTooltip>
  );
}

/** Closed until the reader hovers, focuses or taps the trigger. */
export const Interactive: Story = {
  render: () => (
    <Stage>
      <GameFactTooltip
        kind="champion"
        factKey="Ahri"
        label="Ahri"
        scout={scoutFor("champion", "Ahri")}
        href="/champions/Ahri"
        resolvePart={resolvePart}
      >
        <Chip variant="float">Ahri</Chip>
      </GameFactTooltip>
    </Stage>
  ),
};

export const Champion: Story = {
  render: () => (
    <Stage>
      <Open
        kind="champion"
        factKey="Ahri"
        label="Ahri"
        href="/champions/Ahri"
      />
    </Stage>
  ),
};

export const Ability: Story = {
  render: () => (
    <Stage>
      <Open kind="ability" factKey="Ahri-E" label="Charm" />
    </Stage>
  ),
};

export const AbilityWithRanks: Story = {
  render: () => (
    <Stage>
      <Open kind="ability" factKey="Ahri-R" label="Spirit Rush" />
    </Stage>
  ),
};

export const Item: Story = {
  render: () => (
    <Stage>
      <Open kind="item" factKey="3118" label="Malignance" />
    </Stage>
  ),
};

export const Rune: Story = {
  render: () => (
    <Stage>
      <Open kind="rune" factKey="8112" label="Electrocute" />
    </Stage>
  ),
};

export const SummonerSpell: Story = {
  render: () => (
    <Stage>
      <Open kind="summoner-spell" factKey="14" label="Ignite" />
    </Stage>
  ),
};

export const Player: Story = {
  render: () => (
    <Stage>
      <RichTooltip
        label="RiverQuartz"
        defaultOpen
        content={
          <PlayerTooltip
            name="RiverQuartz"
            group="Rift Study Group"
            rank={{
              tier: "Emerald",
              division: "I",
              leaguePoints: 22,
              queue: "Solo/Duo",
            }}
            latestGame={{
              result: "Won",
              detail: "as Jinx, 10/3/9, 2 hours ago",
            }}
            scout={
              <TooltipScoutRows>
                <TooltipScoutRow who="You" you>
                  <span>9 games together, won 6</span>
                  <TooltipTally
                    results={[
                      true,
                      true,
                      true,
                      true,
                      true,
                      true,
                      false,
                      false,
                      false,
                    ]}
                  />
                </TooltipScoutRow>
              </TooltipScoutRows>
            }
            profileHref="/players/RiverQuartz"
            compareHref="/compare/RiverQuartz"
          />
        }
      >
        <Chip variant="float">RiverQuartz</Chip>
      </RichTooltip>
    </Stage>
  ),
};

/** Ahri, her Charm, and the keyword inside it, each beside the one before. */
export const ThreeLayers: Story = {
  render: () => (
    <Stage>
      <GameFactTooltip
        kind="champion"
        factKey="Ahri"
        label="Ahri"
        scout={scoutFor("champion", "Ahri")}
        href="/champions/Ahri"
        resolvePart={resolvePart}
        defaultOpenParts={["ability/Ahri-E", "keyword/charm"]}
        defaultOpen
      >
        <Chip variant="float">Ahri</Chip>
      </GameFactTooltip>
    </Stage>
  ),
};

export const Loading: Story = {
  render: () => (
    <Stage loader={stalledLoader}>
      <Open kind="ability" factKey="Ahri-E" label="Charm" />
    </Stage>
  ),
};

export const LoadFailed: Story = {
  render: () => (
    <Stage loader={failingLoader}>
      <Open kind="ability" factKey="Ahri-E" label="Charm" />
    </Stage>
  ),
};

/** On a phone a tap opens the same content in a bottom sheet. */
export const PhoneSheet: Story = {
  render: () => (
    <Stage>
      <GameFactTooltip
        kind="champion"
        factKey="Ahri"
        label="Ahri"
        scout={scoutFor("champion", "Ahri")}
        href="/champions/Ahri"
        resolvePart={resolvePart}
        presentation="sheet"
        defaultOpen
      >
        <Chip variant="float">Ahri</Chip>
      </GameFactTooltip>
    </Stage>
  ),
};
