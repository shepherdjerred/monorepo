import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "#src/components/surfaces/chip.tsx";
import { ChampionFace } from "./champion-face.tsx";
import { DuelHero } from "./duel-hero.tsx";

const meta = {
  title: "Domain/DuelHero",
  component: DuelHero,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (story) => (
      <div style={{ maxWidth: "70rem", margin: "0 auto", padding: "1rem" }}>
        {story()}
      </div>
    ),
  ],
} satisfies Meta<typeof DuelHero>;

export default meta;

type Story = StoryObj<typeof meta>;

const h1 = {
  margin: 0,
  font: "700 clamp(1.75rem, 4.5vw, 3.125rem)/1.05 var(--scout-font-display)",
  overflowWrap: "anywhere",
} as const;

function Verdict(props: { a: string; b: string; id: string }) {
  return (
    <>
      <h1 id={props.id} style={h1}>
        {props.a}{" "}
        <span
          style={{ fontWeight: 500, color: "var(--scout-color-text-muted)" }}
        >
          against
        </span>{" "}
        {props.b}
      </h1>
      <p
        style={{
          margin: "0.875rem 0 0",
          font: "500 clamp(1.25rem, 2.5vw, 2rem)/1.2 var(--scout-font-display)",
        }}
      >
        {props.b} has the edge.
      </p>
      <p className="scout-muted" style={{ margin: "0.5rem 0 0" }}>
        {props.a} wins 47.8% of 1,050 games against her.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.5rem",
          marginTop: "1.125rem",
        }}
      >
        <Chip pressed>
          <ChampionFace champion="Ahri" size={26} alt="" />
          I&apos;m playing Ahri
        </Chip>
        <Chip>
          <ChampionFace champion="Syndra" size={26} alt="" />
          I&apos;m playing Syndra
        </Chip>
      </div>
    </>
  );
}

export const Default: Story = {
  args: {
    start: { champion: "Ahri", face: "left" },
    end: { champion: "Syndra", face: "left" },
    "aria-labelledby": "duel-default",
    children: <Verdict a="Ahri" b="Syndra" id="duel-default" />,
  },
};

export const ArtFacingAway: Story = {
  args: {
    start: { champion: "Jinx", face: "right" },
    end: { champion: "Thresh", face: "right" },
    "aria-labelledby": "duel-away",
    children: <Verdict a="Jinx" b="Thresh" id="duel-away" />,
  },
};

export const MirroredByFlag: Story = {
  args: {
    start: { champion: "Ahri", mirrored: false },
    end: { champion: "Syndra", mirrored: true },
    "aria-labelledby": "duel-flag",
    children: <Verdict a="Ahri" b="Syndra" id="duel-flag" />,
  },
};

export const LongNames: Story = {
  args: {
    start: { champion: "Nunu", face: "left" },
    end: { champion: "Renata", face: "left" },
    "aria-labelledby": "duel-long",
    children: <Verdict a="Nunu & Willump" b="Renata Glasc" id="duel-long" />,
  },
};

export const WordsOnly: Story = {
  args: {
    start: { champion: "Ahri" },
    end: { champion: "Syndra" },
    "aria-labelledby": "duel-short",
    children: (
      <h1 id="duel-short" style={h1}>
        Ahri against Syndra
      </h1>
    ),
  },
};
