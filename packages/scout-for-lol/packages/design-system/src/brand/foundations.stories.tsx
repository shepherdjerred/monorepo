import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { scoutThemes } from "#src/generated/tokens.ts";
import { ScoutEmblem, ScoutMark } from "./index.tsx";

const meta = {
  title: "Brand/Foundations",
  component: ScoutMark,
  tags: ["autodocs"],
} satisfies Meta<typeof ScoutMark>;

export default meta;

type Story = StoryObj<typeof meta>;

// Token names are generated in camelCase; the stylesheet publishes them as
// kebab-case custom properties. Resolving through `var()` rather than the
// literal hex keeps every swatch following the theme the toolbar selects.
function colorTokenVariable(name: string): string {
  return `var(--scout-color-${name.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()})`;
}

function fontTokenVariable(name: string): string {
  return `var(--scout-font-${name})`;
}

// `modern-dark` is only the enumeration source: every theme declares the same
// token names, so the grid stays complete whichever skin renders it.
const colorTokens = Object.entries(scoutThemes["modern-dark"].colors);
const typographyTokens = Object.entries(scoutThemes["modern-dark"].typography);

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
  gap: "0.75rem",
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const swatchStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  padding: "0.75rem",
  border: "1px solid var(--scout-color-border)",
  borderRadius: "var(--scout-radius-medium)",
  background: "var(--scout-color-surface)",
};

const chipStyle: CSSProperties = {
  display: "block",
  height: "3rem",
  borderRadius: "var(--scout-radius-small)",
  border: "1px solid var(--scout-color-border)",
};

export const ColorTokens: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul style={gridStyle}>
      {colorTokens.map(([name, value]) => (
        <li key={name} style={swatchStyle}>
          <span
            aria-hidden="true"
            style={{ ...chipStyle, background: colorTokenVariable(name) }}
          />
          <strong>{name}</strong>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  ),
};

export const TypographyTokens: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul style={{ ...gridStyle, gridTemplateColumns: "1fr" }}>
      {typographyTokens.map(([name]) => (
        <li key={name} style={swatchStyle}>
          <strong>{name}</strong>
          <span
            style={{ fontFamily: fontTokenVariable(name), fontSize: "1.5rem" }}
          >
            Baron Nashor respawns in 6:00
          </span>
        </li>
      ))}
    </ul>
  ),
};

export const Emblem: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ScoutEmblem width={96} height={96} />,
};

export const EmblemLabelled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ScoutEmblem width={96} height={96} role="img" aria-label="Scout emblem" />
  ),
};

export const Mark: Story = { args: {} };

export const MarkCompact: Story = { args: { compact: true } };
