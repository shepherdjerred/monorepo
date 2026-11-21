import type { EmailTone } from "./primitives.ts";

export type ToneColors = {
  bg: string;
  ink: string;
  border: string;
  accent: string;
  darkBg: string;
  darkInk: string;
  darkBorder: string;
  darkAccent: string;
};

export type EditorialPalette = {
  maxWidthPx: number;
  fontSans: string;
  fontMono: string;
  canvasLight: string;
  canvasDark: string;
  surfaceLight: string;
  surfaceDark: string;
  subtleLight: string;
  subtleDark: string;
  inkLight: string;
  inkDark: string;
  secondaryInkLight: string;
  secondaryInkDark: string;
  mutedLight: string;
  mutedDark: string;
  borderLight: string;
  borderDark: string;
  chipBgLight: string;
  chipBgDark: string;
  brandLight: string;
  brandDark: string;
  ctaBgLight: string;
  ctaInkLight: string;
  ctaBgDark: string;
  ctaInkDark: string;
  tones: Record<EmailTone, ToneColors>;
};

const SYSTEM_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const SYSTEM_MONO =
  "'Berkeley Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace";

const EDITORIAL_TONES: Record<EmailTone, ToneColors> = {
  critical: {
    bg: "#fde9e7",
    ink: "#9d241e",
    border: "#f5c2bd",
    accent: "#d03b3b",
    darkBg: "#3d1716",
    darkInk: "#f7b2ad",
    darkBorder: "#6b2623",
    darkAccent: "#f06a63",
  },
  warning: {
    bg: "#fff2cf",
    ink: "#7a4f00",
    border: "#f0d9a0",
    accent: "#d48806",
    darkBg: "#3a2c0a",
    darkInk: "#f7ce6d",
    darkBorder: "#5a4717",
    darkAccent: "#fab219",
  },
  ok: {
    bg: "#e3f4e3",
    ink: "#0a5c0a",
    border: "#b8e2b8",
    accent: "#176b4d",
    darkBg: "#12301b",
    darkInk: "#8ee09c",
    darkBorder: "#1f512e",
    darkAccent: "#4cc393",
  },
  info: {
    bg: "#e5f2fc",
    ink: "#175989",
    border: "#b9daf4",
    accent: "#2a78d6",
    darkBg: "#132a42",
    darkInk: "#9cc9f7",
    darkBorder: "#1e446b",
    darkAccent: "#63a7f2",
  },
  neutral: {
    bg: "#ecebe7",
    ink: "#4b4a47",
    border: "#d9ded8",
    accent: "#5f6a64",
    darkBg: "#2a2a28",
    darkInk: "#d2d1c9",
    darkBorder: "#3b3e3a",
    darkAccent: "#a3ada7",
  },
};

/** Hub Editorial palette derived from `packages/alert-dashboard/src/styles/globals.css`. */
export const HUB_EDITORIAL_PALETTE: EditorialPalette = {
  maxWidthPx: 620,
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  canvasLight: "#f4f6f2",
  canvasDark: "#0f1311",
  surfaceLight: "#ffffff",
  surfaceDark: "#171b19",
  subtleLight: "#f8faf7",
  subtleDark: "#1d2220",
  inkLight: "#17211c",
  inkDark: "#edf2ee",
  secondaryInkLight: "#2c3832",
  secondaryInkDark: "#d3dcd6",
  mutedLight: "#58655e",
  mutedDark: "#9eaaa3",
  borderLight: "#dce1db",
  borderDark: "#2d3531",
  chipBgLight: "#f1f4f0",
  chipBgDark: "#222825",
  brandLight: "#176b4d",
  brandDark: "#4cc393",
  ctaBgLight: "#176b4d",
  ctaInkLight: "#ffffff",
  ctaBgDark: "#4cc393",
  ctaInkDark: "#0b1712",
  tones: EDITORIAL_TONES,
};
