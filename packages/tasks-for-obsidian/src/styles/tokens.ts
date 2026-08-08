import { StyleSheet } from "react-native";

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  small: 6,
  medium: 10,
  large: 14,
  capsule: 999,
} as const;

export const controlSize = {
  minimumHitTarget: 44,
  comfortableHitTarget: 48,
} as const;

export const separator = {
  hairline: StyleSheet.hairlineWidth,
} as const;
