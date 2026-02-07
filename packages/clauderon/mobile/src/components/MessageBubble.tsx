import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import type { Message } from "../lib/claudeParser";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { formatTime } from "../lib/utils";
import Markdown from "react-native-markdown-display";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/styles/hljs";
import { PlanView, isPlan } from "./PlanView";
import { QuestionView, isQuestion } from "./QuestionView";

type MessageBubbleProps = {
  message: Message;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  // Don't render if there's no displayable content
  const hasContent = message.content?.trim();
  const hasToolUses = message.toolUses && message.toolUses.length > 0;
  const hasCodeBlocks = message.codeBlocks && message.codeBlocks.length > 0;

  if (!hasContent && !hasToolUses && !hasCodeBlocks) {
    return null;
  }

  const isUser = message.role === "user";
  const messageIsPlan = isPlan(message);
  const messageIsQuestion = isQuestion(message);

  // Render question with special styling
  if (messageIsQuestion && !isUser) {
    return (
      <View style={styles.planContainer}>
        <QuestionView message={message} />
      </View>
    );
  }

  // Render plan with special styling
  if (messageIsPlan && !isUser) {
    return (
      <View style={styles.planContainer}>
        <PlanView message={message} />
      </View>
    );
  }

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {message.content && <Markdown style={markdownStyles}>{message.content}</Markdown>}

        {message.toolUses && message.toolUses.length > 0 && (
          <View style={styles.toolsContainer}>
            {message.toolUses.map((tool, index) => (
              <View key={index} style={styles.toolBadge}>
                <Text style={styles.toolName}>{tool.name}</Text>
                {tool.description && (
                  <Text style={styles.toolDesc} numberOfLines={1}>
                    {tool.description}
                  </Text>
                )}
                {tool.result && (
                  <View style={styles.toolResult}>
                    <Text style={styles.toolResultText}>{tool.result}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {message.codeBlocks && message.codeBlocks.length > 0 && (
          <View style={styles.codeBlocksContainer}>
            {message.codeBlocks.map((block, index) => (
              <View key={index} style={styles.codeBlock}>
                <View style={styles.codeHeader}>
                  <Text style={styles.codeLang}>{block.language}</Text>
                  {block.filePath && <Text style={styles.codeFilePath}>{block.filePath}</Text>}
                </View>
                <ScrollView horizontal style={styles.codeScroll}>
                  <View style={styles.codeContent}>
                    <SyntaxHighlighter
                      language={block.language ?? "text"}
                      style={atomOneDark}
                      customStyle={{
                        backgroundColor: colors.backgroundDark,
                        padding: 8,
                      }}
                      fontSize={typography.fontSize.sm}
                      fontFamily={typography.fontFamily.mono}
                      highlighter="hljs"
                    >
                      {block.code}
                    </SyntaxHighlighter>
                  </View>
                </ScrollView>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  planContainer: {
    padding: 16,
    backgroundColor: colors.background,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  userContainer: {
    alignItems: "flex-end",
  },
  assistantContainer: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    padding: 12,
    borderWidth: 3,
    borderColor: colors.border,
  },
  userBubble: {
    backgroundColor: colors.primaryLight,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
  },
  content: {
    fontSize: typography.fontSize.base,
    color: colors.textDark,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },
  toolsContainer: {
    marginTop: 8,
    gap: 4,
  },
  toolBadge: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 6,
  },
  toolName: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
    textTransform: "uppercase",
  },
  toolDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
    marginTop: 2,
  },
  toolResult: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
  },
  toolResultText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textDark,
  },
  codeBlocksContainer: {
    marginTop: 8,
    gap: 8,
  },
  codeBlock: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundDark,
    overflow: "hidden",
  },
  codeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  codeLang: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  codeFilePath: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textWhite,
  },
  codeScroll: {
    maxHeight: 300,
  },
  codeContent: {
    minWidth: "100%",
  },
  timestamp: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginTop: 4,
  },
});

const markdownStyles = {
  body: {
    fontSize: typography.fontSize.base,
    color: colors.textDark,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },
  heading1: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    marginBottom: 8,
  },
  heading2: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
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
  code_block: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    color: colors.textWhite,
  },
  link: {
    color: colors.primary,
    textDecorationLine: "underline" as const,
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    marginVertical: 8,
  },
};
