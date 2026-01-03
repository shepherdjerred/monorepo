import { StyleSheet, Platform } from "react-native";
import { colors } from "./colors";
import { typography } from "./typography";

/**
 * Common style definitions
 */
export const commonStyles = StyleSheet.create({
  // Container styles
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Card styles (brutalist)
  card: {
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: colors.border,
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: {
        elevation: 4,
      },
    }),
  },

  // Text styles
  heading1: {
    fontSize: typography.fontSize["3xl"],
    fontWeight: typography.fontWeight.extrabold,
    color: colors.textDark,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  heading2: {
    fontSize: typography.fontSize["2xl"],
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },

  heading3: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
  },

  bodyText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.normal,
    color: colors.text,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },

  monoText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    color: colors.text,
  },

  // Button styles (brutalist)
  button: {
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 20,
    ...Platform.select({
      ios: {
        shadowColor: colors.border,
        shadowOffset: { width: 3, height: 3 },
        shadowOpacity: 1,
        shadowRadius: 0,
      },
      android: {
        elevation: 3,
      },
    }),
  },

  buttonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Input styles
  input: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 12,
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.regular,
    color: colors.text,
  },

  // Badge styles
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },

  // Loading indicator container
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },

  emptyStateText: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textLight,
    textAlign: "center",
  },
});
