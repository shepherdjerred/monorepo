import type { Meta, StoryObj } from "@storybook/react-vite";
import { NameText } from "./name-text.tsx";
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

const rows = [
  { key: "Ahri", name: "Ahri" },
  { key: "Syndra", name: "Syndra" },
  { key: "Jinx", name: "Jinx" },
  { key: "Thresh", name: "Thresh" },
  { key: "Nunu", name: "Nunu & Willump" },
  { key: "Renata", name: "Renata Glasc" },
];

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

function FeedRows(props: { maxWidth?: string }) {
  return (
    <ul
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "0.875rem",
        listStyle: "none",
        margin: 0,
        padding: 0,
        ...(props.maxWidth === undefined ? {} : { maxWidth: props.maxWidth }),
      }}
    >
      {rows.map((row, index) => (
        <li
          key={row.key}
          style={{ display: "flex", alignItems: "center", gap: "1rem" }}
        >
          <ChampionFace
            champion={row.key}
            result={index % 3 === 1 ? "loss" : "win"}
            alt=""
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <NameText>
              {`${index % 3 === 1 ? "Lost" : "Won"} as ${row.name}, 9/2/11, +21 LP`}
            </NameText>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const InAFeed: Story = {
  parameters: { controls: { disable: true } },
  render: () => <FeedRows />,
};

export const LongTextInANarrowFeed: Story = {
  parameters: { controls: { disable: true } },
  render: () => <FeedRows maxWidth="17rem" />,
};
