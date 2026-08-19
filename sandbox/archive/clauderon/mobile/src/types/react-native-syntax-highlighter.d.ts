declare module "react-native-syntax-highlighter" {
  import type { ComponentType } from "react";

  type SyntaxHighlighterProps = {
    language?: string;
    style?: Record<string, unknown>;
    customStyle?: Record<string, unknown>;
    fontSize?: number;
    fontFamily?: string;
    highlighter?: "prism" | "hljs";
    children: string;
  };

  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>;
  export default SyntaxHighlighter;
}
