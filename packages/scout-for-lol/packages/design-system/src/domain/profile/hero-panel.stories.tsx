import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search } from "lucide-react";
import { Chip } from "#src/components/surfaces/chip.tsx";
import { HeroPanel } from "./hero-panel.tsx";
import { RankLockup } from "./rank-lockup.tsx";

const meta = {
  title: "Domain/HeroPanel",
  component: HeroPanel,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (story) => (
      <div style={{ maxWidth: "70rem", margin: "0 auto", padding: "1rem" }}>
        {story()}
      </div>
    ),
  ],
} satisfies Meta<typeof HeroPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

const h1 = {
  margin: 0,
  font: "700 clamp(2.5rem, 6vw, 3.75rem)/1 var(--scout-font-display)",
  overflowWrap: "anywhere",
} as const;

function Words(props: { name: string; id: string }) {
  return (
    <>
      <h1 id={props.id} style={h1}>
        {props.name}
      </h1>
      <RankLockup
        rank="Emerald"
        division="II"
        leaguePoints={64}
        secondary="Platinum I, 12 LP in Flex"
      />
      <p className="scout-muted" style={{ margin: "0.75rem 0 0" }}>
        Mid main in Rift Study Group. Mostly plays Ahri, Syndra and Orianna.
      </p>
    </>
  );
}

const findAnother = (
  <Chip variant="float" href="#find">
    <Search size={18} aria-hidden="true" />
    Find another player
  </Chip>
);

export const Default: Story = {
  args: {
    art: { champion: "Ahri" },
    "aria-labelledby": "hero-default",
    action: findAnother,
    children: <Words name="Northstar" id="hero-default" />,
  },
};

export const WordsOnTheRight: Story = {
  args: {
    art: { champion: "Syndra" },
    align: "end",
    "aria-labelledby": "hero-end",
    action: findAnother,
    children: <Words name="Northstar" id="hero-end" />,
  },
};

export const ArtFacingAway: Story = {
  args: {
    art: { champion: "Jinx", face: "right" },
    "aria-labelledby": "hero-away",
    children: <Words name="Northstar" id="hero-away" />,
  },
};

export const ArtFacingTheWords: Story = {
  args: {
    art: { champion: "Jinx", face: "left" },
    "aria-labelledby": "hero-toward",
    children: <Words name="Northstar" id="hero-toward" />,
  },
};

export const MirroredByFlag: Story = {
  args: {
    art: { champion: "Thresh", mirrored: true },
    "aria-labelledby": "hero-flag",
    children: <Words name="Northstar" id="hero-flag" />,
  },
};

export const LongName: Story = {
  args: {
    art: { champion: "Nunu" },
    "aria-labelledby": "hero-long",
    action: findAnother,
    children: (
      <Words
        name="A summoner with a name that is much too long to sit on one line"
        id="hero-long"
      />
    ),
  },
};

export const NoArt: Story = {
  args: {
    "aria-labelledby": "hero-plain",
    action: findAnother,
    children: <Words name="Northstar" id="hero-plain" />,
  },
};

export const NoArtWordsOnly: Story = {
  args: {
    "aria-labelledby": "hero-bare",
    children: (
      <>
        <h1 id="hero-bare" style={h1}>
          Northstar
        </h1>
        <p className="scout-muted" style={{ margin: "0.75rem 0 0" }}>
          No games recorded yet.
        </p>
      </>
    ),
  },
};
