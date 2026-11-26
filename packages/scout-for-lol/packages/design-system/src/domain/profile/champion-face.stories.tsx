import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CHAMPION_FACE_SIZES,
  ChampionFace,
  type ChampionFaceResult,
} from "./champion-face.tsx";

const meta = {
  title: "Domain/ChampionFace",
  component: ChampionFace,
  tags: ["autodocs"],
  args: { champion: "Ahri" },
} satisfies Meta<typeof ChampionFace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Win: Story = { args: { result: "win" } };

export const Loss: Story = { args: { result: "loss" } };

export const ByNumericId: Story = { args: { champion: 103, result: "win" } };

export const Decorative: Story = {
  args: { champion: "Syndra", alt: "" },
};

const champions = ["Ahri", "Syndra", "Jinx", "Thresh", "Nunu", "Renata"];

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
      {CHAMPION_FACE_SIZES.map((size) => (
        <ChampionFace key={size} champion="Ahri" size={size} />
      ))}
    </div>
  ),
};

export const SizesWithResults: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {(["win", "loss"] satisfies ChampionFaceResult[]).map((result) => (
        <div
          key={result}
          style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}
        >
          {CHAMPION_FACE_SIZES.map((size) => (
            <ChampionFace
              key={size}
              champion="Jinx"
              size={size}
              result={result}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};

export const InAFeed: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul
      style={{
        display: "grid",
        gap: "0.875rem",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {champions.map((champion, index) => (
        <li
          key={champion}
          style={{ display: "flex", alignItems: "center", gap: "1rem" }}
        >
          <ChampionFace
            champion={champion}
            result={index % 3 === 1 ? "loss" : "win"}
            alt=""
          />
          <span>
            {index % 3 === 1 ? "Lost" : "Won"} as {champion}
          </span>
        </li>
      ))}
    </ul>
  ),
};
