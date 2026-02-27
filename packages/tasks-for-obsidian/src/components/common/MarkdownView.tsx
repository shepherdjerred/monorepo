import React, { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import Markdown from "react-native-markdown-display";
import { useSettings } from "../../hooks/use-settings";

type Props = {
  content: string;
};

type MarkdownStyles = Record<string, TextStyle | ViewStyle>;

function MarkdownViewInner({ content }: Props) {
  const { colors } = useSettings();

  const markdownStyles = useMemo((): MarkdownStyles => ({
    body: { color: colors.text, fontSize: 15, lineHeight: 22 },
    heading1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 19, fontWeight: "600", marginBottom: 6 },
    heading3: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: 4 },
    paragraph: { marginBottom: 8 },
    link: { color: colors.primary },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 12,
      marginLeft: 0,
      backgroundColor: colors.surface,
    },
    code_inline: {
      backgroundColor: colors.surface,
      color: colors.primary,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      fontSize: 13,
    },
    code_block: {
      backgroundColor: colors.surface,
      padding: 12,
      borderRadius: 8,
      fontSize: 13,
    },
    fence: {
      backgroundColor: colors.surface,
      padding: 12,
      borderRadius: 8,
      fontSize: 13,
    },
    list_item: { marginBottom: 4 },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    s: { textDecorationLine: "line-through" },
    table: { borderColor: colors.border, borderWidth: 1 },
    thead: { backgroundColor: colors.surface },
    th: { padding: 6, borderColor: colors.border },
    td: { padding: 6, borderColor: colors.border },
  }), [colors]);

  return <Markdown style={markdownStyles}>{content}</Markdown>;
}

export const MarkdownView = React.memo(MarkdownViewInner);
