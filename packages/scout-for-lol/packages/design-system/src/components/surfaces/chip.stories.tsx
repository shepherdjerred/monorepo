import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { resolveGameAssetUrl } from "#src/assets/index.tsx";
import { Chip, ChipLane } from "./chip.tsx";

const meta = {
  title: "Components/Chip",
  component: Chip,
  tags: ["autodocs"],
} satisfies Meta<typeof Chip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Ranked Solo" } };

export const Pressed: Story = {
  args: { children: "Ranked Solo", pressed: true },
};

export const Go: Story = { args: { children: "Apply", variant: "go" } };

export const Ghost: Story = {
  args: { children: "Reset filters", variant: "ghost" },
};

export const Float: Story = {
  args: { children: "Back to top", variant: "float" },
};

export const Link: Story = {
  args: { children: "Open scouting report", href: "#report", variant: "go" },
};

export const Disabled: Story = {
  args: { children: "Unavailable", disabled: true },
};

export const AllVariants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      <Chip>Default</Chip>
      <Chip pressed>Pressed</Chip>
      <Chip variant="go">Go</Chip>
      <Chip variant="ghost">Ghost</Chip>
      <Chip variant="float">Float</Chip>
      <Chip href="#link">Link</Chip>
      <Chip href="#current" pressed>
        Current link
      </Chip>
      <Chip disabled>Disabled</Chip>
    </div>
  ),
};

const champions = ["Ahri", "Jinx", "Thresh"] as const;

function ChampionFilter() {
  const [selected, setSelected] = useState<string>("Ahri");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {champions.map((champion) => (
        <Chip
          key={champion}
          pressed={selected === champion}
          onClick={() => {
            setSelected(champion);
          }}
        >
          <ChipLane>
            <img
              src={resolveGameAssetUrl("champion", champion)}
              alt=""
              width={24}
              height={24}
              style={{ borderRadius: "50%" }}
            />
          </ChipLane>
          {champion}
        </Chip>
      ))}
      <Chip variant="ghost">
        <SlidersHorizontal size={16} aria-hidden="true" />
        More filters
      </Chip>
    </div>
  );
}

export const ChampionFilters: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ChampionFilter />,
};
