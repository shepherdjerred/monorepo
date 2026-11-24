import type { EmailTone } from "./primitives.ts";

/**
 * Per-tone colours. `bg` is the soft tint, `ink` the text-safe colour, `accent`
 * the fill used for dots, and `border` the hairline (the `line` token; the
 * console has no tinted severity border).
 */
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
  hairlineLight: string;
  hairlineDark: string;
  brandLight: string;
  brandDark: string;
  ctaBgLight: string;
  ctaInkLight: string;
  ctaBgDark: string;
  ctaInkDark: string;
  ctaEdgeLight: string;
  ctaEdgeDark: string;
  tones: Record<EmailTone, ToneColors>;
};

const SYSTEM_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const SYSTEM_MONO =
  "'Berkeley Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace";

/**
 * Literal copies of `packages/console-ui/src/tokens.json` (ops-model is a
 * runtime library and must not depend on console-ui). `themes.test.ts` asserts
 * every value against the tokens. Tone mapping: critical -> error,
 * warning -> warning, ok -> ok, info -> info, neutral -> unknown.
 */
const EDITORIAL_TONES: Record<EmailTone, ToneColors> = {
  critical: {
    bg: "#faebea",
    ink: "#b72d26",
    border: "#dfe0d7",
    accent: "#d1332b",
    darkBg: "#3e2a27",
    darkInk: "#ff7f76",
    darkBorder: "#2a2c28",
    darkAccent: "#ff7f76",
  },
  warning: {
    bg: "#f8f1e6",
    ink: "#895700",
    border: "#dfe0d7",
    accent: "#bb7700",
    darkBg: "#3b3320",
    darkInk: "#f0b84a",
    darkBorder: "#2a2c28",
    darkAccent: "#f0b84a",
  },
  ok: {
    bg: "#e8f3ed",
    ink: "#17703b",
    border: "#dfe0d7",
    accent: "#1c8a48",
    darkBg: "#27372b",
    darkInk: "#6fd08c",
    darkBorder: "#2a2c28",
    darkAccent: "#6fd08c",
  },
  info: {
    bg: "#eaf1f9",
    ink: "#2a62aa",
    border: "#dfe0d7",
    accent: "#2f6fc0",
    darkBg: "#2a333b",
    darkInk: "#84b4f0",
    darkBorder: "#2a2c28",
    darkAccent: "#84b4f0",
  },
  neutral: {
    bg: "#f3f3f2",
    ink: "#5d5e57",
    border: "#dfe0d7",
    accent: "#868680",
    darkBg: "#2c2d2a",
    darkInk: "#a2a49a",
    darkBorder: "#2a2c28",
    darkAccent: "#8e9088",
  },
};

/**
 * Email palette: the console-ui tokens as literals. canvas=bg, surface=panel,
 * subtle=head, secondaryInk=ink-2, border=line, hairline=line-soft,
 * brand/cta=accent, ctaInk=on-accent, ctaEdge=accent mixed 65% with black (the
 * console's primary button edge).
 */
export const HUB_EDITORIAL_PALETTE: EditorialPalette = {
  maxWidthPx: 620,
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  canvasLight: "#ecede6",
  canvasDark: "#111210",
  surfaceLight: "#ffffff",
  surfaceDark: "#191a18",
  subtleLight: "#f8f8f4",
  subtleDark: "#1e201d",
  inkLight: "#1a1b18",
  inkDark: "#ecede8",
  secondaryInkLight: "#3f413b",
  secondaryInkDark: "#cbccc5",
  mutedLight: "#5a5c53",
  mutedDark: "#a2a49a",
  borderLight: "#dfe0d7",
  borderDark: "#2a2c28",
  hairlineLight: "#eeefe9",
  hairlineDark: "#222421",
  brandLight: "#176b4d",
  brandDark: "#4cc393",
  ctaBgLight: "#176b4d",
  ctaInkLight: "#ffffff",
  ctaBgDark: "#4cc393",
  ctaInkDark: "#0c1410",
  ctaEdgeLight: "#0f4632",
  ctaEdgeDark: "#317f60",
  tones: EDITORIAL_TONES,
};
