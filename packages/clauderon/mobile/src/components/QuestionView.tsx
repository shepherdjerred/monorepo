import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Message } from "../lib/claudeParser";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";

type QuestionViewProps = {
  message: Message;
};

export function QuestionView({ message }: QuestionViewProps) {
  // Find the AskUserQuestion tool use
  const questionTool = message.toolUses?.find(tool => tool.name === "AskUserQuestion");

  if (!questionTool || !questionTool.input) {
    return null;
  }

  const questions = questionTool.input['questions'] as Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>❓</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Question{questions.length > 1 ? "s" : ""}</Text>
          <Text style={styles.subtitle}>Claude Code is asking for your input</Text>
        </View>
      </View>

      {/* Questions */}
      <View style={styles.questionsContainer}>
        {questions.map((q, idx) => (
          <View key={idx} style={styles.questionBlock}>
            {/* Question header */}
            <View style={styles.questionHeader}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{q.header}</Text>
              </View>
              <Text style={styles.questionText}>{q.question}</Text>
            </View>

            {/* Options */}
            <View style={styles.optionsContainer}>
              {q.options?.map((option, optIdx) => (
                <View key={optIdx} style={styles.option}>
                  <View style={styles.checkbox} />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                </View>
              ))}
              {/* Other option */}
              <View style={styles.option}>
                <View style={styles.checkbox} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Other</Text>
                  <Text style={styles.optionDescription}>Provide custom input</Text>
                </View>
              </View>
            </View>

            {q.multiSelect && (
              <Text style={styles.multiSelectNote}>* Multiple selections allowed</Text>
            )}
          </View>
        ))}
      </View>

      {/* Note */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          📝 This question was presented in the active Claude Code session. Check the terminal for response status.
        </Text>
      </View>
    </View>
  );
}

/**
 * Check if a message contains a question (AskUserQuestion tool use)
 */
export function isQuestion(message: Message): boolean {
  return message.toolUses?.some(tool => tool.name === "AskUserQuestion") ?? false;
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 4,
    borderColor: colors.accent || colors.primary,
    backgroundColor: colors.surface,
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
  questionsContainer: {
    gap: 16,
  },
  questionBlock: {
    gap: 12,
  },
  questionHeader: {
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.primary,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily.mono,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  questionText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textDark,
  },
  optionsContainer: {
    paddingLeft: 12,
    gap: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  checkbox: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderWidth: 2,
    borderColor: colors.border,
  },
  optionContent: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
  },
  optionDescription: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
  },
  multiSelectNote: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
    fontStyle: "italic",
    paddingLeft: 12,
  },
  footer: {
    borderTopWidth: 2,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 16,
  },
  footerText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
  },
});
