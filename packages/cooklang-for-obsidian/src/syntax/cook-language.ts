import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { cookParser } from "./cook-tokenizer.ts";

/** StreamLanguage definition for Cooklang syntax highlighting in CodeMirror 6. */
export const cookLanguage = StreamLanguage.define(cookParser);

const cookHighlightStyle = HighlightStyle.define([
  { tag: tags.variableName, color: "var(--color-purple)", fontWeight: 500 },
  { tag: tags.keyword, color: "var(--color-cyan)", fontWeight: 500 },
  { tag: tags.number, color: "var(--color-orange)", fontWeight: 600 },
  { tag: tags.heading, color: "var(--text-normal)", fontWeight: 700 },
  { tag: tags.meta, color: "var(--text-faint)" },
  { tag: tags.atom, color: "var(--color-blue)", fontWeight: 500 },
  { tag: tags.string, color: "var(--text-normal)" },
  { tag: tags.docString, color: "var(--text-muted)" },
  { tag: tags.operator, color: "var(--text-faint)" },
  { tag: tags.url, color: "var(--text-accent)" },
  { tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
]);

export const cookHighlighting = syntaxHighlighting(cookHighlightStyle);
