import type { Meta, StoryObj } from "@storybook/react-vite";
import { NameText } from "./name-text.tsx";
import { PersonInitial } from "./person-initial.tsx";

const meta = {
  title: "Domain/PersonInitial",
  component: PersonInitial,
  tags: ["autodocs"],
  args: { name: "RiverQuartz" },
} satisfies Meta<typeof PersonInitial>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const You: Story = { args: { name: "Northstar", you: true } };

export const Live: Story = { args: { live: true } };

export const WithChampion: Story = { args: { champion: "Ahri" } };

export const LiveYouWithChampion: Story = {
  args: { name: "Northstar", you: true, live: true, champion: "Syndra" },
};

const row = { display: "flex", alignItems: "center", gap: "1.5rem" } as const;

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={row}>
      <PersonInitial name="RiverQuartz" size="s" />
      <PersonInitial name="RiverQuartz" size="m" />
      <PersonInitial name="RiverQuartz" size="l" />
      <PersonInitial name="Northstar" size="s" you />
      <PersonInitial name="Northstar" size="m" you />
      <PersonInitial name="Northstar" size="l" you />
    </div>
  ),
};

export const SizesWithBadgeAndLive: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={row}>
      <PersonInitial name="RiverQuartz" size="s" champion="Jinx" live />
      <PersonInitial name="RiverQuartz" size="m" champion="Jinx" live />
      <PersonInitial name="RiverQuartz" size="l" champion="Jinx" live />
    </div>
  ),
};

export const UnusualNames: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={row}>
      {[
        "@mapleCarry",
        "#1 Fan",
        "유나",
        "ñandú",
        "🙂 smile",
        "xX_ExtremelyLongSummonerNameThatKeepsGoing_Xx",
        "",
      ].map((name) => (
        <PersonInitial key={name} name={name} />
      ))}
    </div>
  ),
};

const people = [
  "Northstar",
  "RiverQuartz",
  "A friend with a very long summoner name that keeps going",
];

function BesideRows(props: { maxWidth: string }) {
  return (
    <ul
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "0.875rem",
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxWidth: props.maxWidth,
      }}
    >
      {people.map((name, index) => (
        <li
          key={name}
          style={{ display: "flex", alignItems: "center", gap: "1rem" }}
        >
          <PersonInitial name={name} you={index === 0} live={index === 1} />
          <b style={{ flex: 1, minWidth: 0 }}>
            <NameText>{name}</NameText>
          </b>
        </li>
      ))}
    </ul>
  );
}

export const BesideNames: Story = {
  parameters: { controls: { disable: true } },
  render: () => <BesideRows maxWidth="20rem" />,
};

export const BesideLongNames: Story = {
  parameters: { controls: { disable: true } },
  render: () => <BesideRows maxWidth="14rem" />,
};
