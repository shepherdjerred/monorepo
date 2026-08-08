import { type ColorValue, PlatformColor } from "react-native";

import type { Colors } from "./colors";

export const darkColors = {
  primary: PlatformColor("systemIndigoColor"),
  primaryDark: PlatformColor("systemIndigoColor"),
  primaryLight: PlatformColor("tertiarySystemFillColor"),

  background: PlatformColor("systemBackgroundColor"),
  surface: PlatformColor("secondarySystemBackgroundColor"),
  surfaceElevated: PlatformColor("tertiarySystemBackgroundColor"),

  text: PlatformColor("labelColor"),
  textSecondary: PlatformColor("secondaryLabelColor"),
  textTertiary: PlatformColor("tertiaryLabelColor"),
  textInverse: PlatformColor("lightTextColor"),

  border: PlatformColor("separatorColor"),
  borderLight: PlatformColor("separatorColor"),
  divider: PlatformColor("separatorColor"),

  success: PlatformColor("systemGreenColor"),
  warning: PlatformColor("systemOrangeColor"),
  error: PlatformColor("systemRedColor"),
  info: PlatformColor("systemBlueColor"),

  priorityHighest: PlatformColor("systemRedColor"),
  priorityHigh: PlatformColor("systemOrangeColor"),
  priorityMedium: PlatformColor("systemBlueColor"),
  priorityLow: PlatformColor("secondaryLabelColor"),
  priorityNone: PlatformColor("systemGray3Color"),

  overlay: "rgba(0, 0, 0, 0.7)",
  shadow: "rgba(0, 0, 0, 0.3)",

  tabBarBackground: PlatformColor("secondarySystemBackgroundColor"),
  tabBarActive: PlatformColor("systemIndigoColor"),
  tabBarInactive: PlatformColor("secondaryLabelColor"),
} satisfies Record<keyof Colors, ColorValue>;
