import { Platform } from "react-native";

/**
 * Typography scale
 */
export const typography = {
  // Font families
  fontFamily: {
    regular: Platform.select({
      ios: "System",
      android: "Roboto",
      default: "System",
    }),
    mono: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },

  // Font sizes
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
  },

  // Font weights
  fontWeight: {
    normal: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
    extrabold: "800" as const,
  },

  // Line heights
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
};
