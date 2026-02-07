import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Message } from "../lib/claudeParser";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import Markdown from "react-native-markdown-display";

type PlanViewProps = {
  message: Message;
};

export function PlanView({ message }: PlanViewProps) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>📋</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Implementation Plan</Text>
          <Text style={styles.subtitle}>Review and approve before implementation</Text>
        </View>
      </View>

      {/* Plan content */}
      <View style={styles.content}>
        <Markdown style={planMarkdownStyles}>{message.content}</Markdown>
      </View>
    </View>
  );
}

/**
 * Check if a message is a plan
 */
export function isPlan(message: Message): boolean {
  // Check for ExitPlanMode tool use
  if (message.toolUses?.some((tool) => tool.name === "ExitPlanMode")) {
    return true;
  }

  // Check for plan-like content
  const content = (message.content ?? "").toLowerCase();
  return (
    content.includes("## implementation plan") ||
    content.includes("# implementation plan") ||
    (content.includes("## plan") && content.includes("implementation"))
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 4,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    marginBottom: 16,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  iconText: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily.mono,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.textDark,
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
    marginTop: 2,
  },
  content: {
    paddingTop: 8,
  },
});

const planMarkdownStyles = {
  body: {
    fontSize: typography.fontSize.base,
    color: colors.textDark,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },
  heading1: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    marginBottom: 12,
  },
  heading2: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    marginBottom: 10,
  },
  heading3: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 8,
    marginBottom: 8,
  },
  list_item: {
    fontSize: typography.fontSize.base,
    marginBottom: 6,
  },
  code_inline: {
    fontFamily: typography.fontFamily.mono,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  fence: {
    fontFamily: typography.fontFamily.mono,
    backgroundColor: colors.backgroundDark,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 8,
    marginVertical: 8,
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    marginVertical: 8,
    fontStyle: "italic",
  },
};
