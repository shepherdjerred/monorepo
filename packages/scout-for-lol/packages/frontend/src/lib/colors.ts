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
  green: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  purple:
    "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
  indigo:
    "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400",
  yellow:
    "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  red: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  gray: "bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400",
};

/**
 * Badge/text colors for inline badges
 */
export const badgeColors: Record<ColorVariant, string> = {
  green: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  purple:
    "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  indigo:
    "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400",
  yellow:
    "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  gray: "bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400",
};

/**
 * Gradient colors for StatCard and similar components
 */
export const gradientColors: Record<string, string> = {
  yellow: "from-yellow-500 to-orange-600",
  purple: "from-purple-600 to-pink-600",
  blue: "from-blue-600 to-cyan-600",
  green: "from-green-500 to-emerald-600",
  red: "from-red-500 to-pink-600",
  indigo: "from-indigo-600 to-purple-600",
};
