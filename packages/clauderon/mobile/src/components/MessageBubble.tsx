import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Message } from "../lib/claudeParser";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { formatTime } from "../lib/utils";

type MessageBubbleProps = {
  message: Message;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text style={styles.content}>{message.content}</Text>

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
              </View>
            ))}
          </View>
        )}

        {message.codeBlocks && message.codeBlocks.length > 0 && (
          <View style={styles.codeBlocksContainer}>
            {message.codeBlocks.map((block, index) => (
              <View key={index} style={styles.codeBlock}>
                <Text style={styles.codeLang}>{block.language}</Text>
                <Text style={styles.code}>{block.code}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.timestamp}>
          {formatTime(message.timestamp)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  codeBlocksContainer: {
    marginTop: 8,
    gap: 8,
  },
  codeBlock: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundDark,
    padding: 8,
  },
  codeLang: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  code: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.textWhite,
  },
  timestamp: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginTop: 4,
  },
});
