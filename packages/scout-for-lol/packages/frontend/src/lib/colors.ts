/**
 * Shared color variant mappings for consistent styling across components
 */

export type ColorVariant =
  | "green"
  | "blue"
  | "purple"
  | "indigo"
  | "yellow"
  | "red"
  | "gray";

export type ColorClasses = {
  bg: string;
  border: string;
  text: string;
  title?: string;
};

/**
 * Icon/badge background colors with dark mode support
 */
export const iconColors: Record<ColorVariant, string> = {
  green: "bg-scout-success text-scout-success-ink",
  blue: "bg-scout-raised text-scout-brand ",
  purple: "bg-scout-accent text-scout-accent-ink",
  indigo: "bg-scout-raised text-scout-brand ",
  yellow: "bg-scout-warning text-scout-warning-ink",
  red: "bg-scout-danger text-scout-danger-ink",
  gray: "bg-scout-raised text-scout-subtle ",
};

/**
 * Badge/text colors for inline badges
 */
export const badgeColors: Record<ColorVariant, string> = {
  green: "bg-scout-success text-scout-success-ink",
  blue: "bg-scout-raised text-scout-brand ",
  purple: "bg-scout-accent text-scout-accent-ink",
  indigo: "bg-scout-raised text-scout-brand ",
  yellow: "bg-scout-warning text-scout-warning-ink",
  red: "bg-scout-danger text-scout-danger-ink",
  gray: "bg-scout-raised text-scout-ink ",
};

/**
 * Gradient colors for StatCard and similar components
 */
export const gradientColors: Record<string, string> = {
  yellow: "from-scout-warning to-scout-accent",
  purple: "from-scout-accent to-scout-accent",
  blue: "from-scout-brand to-scout-accent",
  green: "from-scout-success to-scout-success",
  red: "from-scout-danger to-scout-accent",
  indigo: "from-scout-brand to-scout-accent",
  teal: "from-scout-accent to-scout-accent",
};
