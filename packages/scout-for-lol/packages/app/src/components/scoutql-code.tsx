import { match } from "ts-pattern";
import {
  scoutQlTokenSpans,
  type ScoutQlTokenKind,
} from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";

// Read-only ScoutQL rendering — Explore transcripts, tool traces, anywhere a
// query is shown rather than edited. It highlights from the same
// `scoutQlTokenSpans` pass the Monaco editor and the docs site use, so the
// three surfaces cannot disagree about what a word is.
//
// The tokenizer tiles the whole input, so the rendered text is the input byte
// for byte — including a malformed query, which paints its unmatched text as
// `invalid` instead of dropping it.

export function ScoutQlCode(props: { queryText: string; className?: string }) {
  const tokens = scoutQlTokenSpans(props.queryText);
  return (
    <pre
      className={`overflow-x-auto rounded-md border border-scout-border bg-scout-hover/50 p-3 font-mono text-xs leading-5 ${props.className ?? ""}`}
    >
      <code>
        {tokens.map((token, index) => (
          <span
            key={`${String(index)}-${token.kind}`}
            className={scoutQlTokenClassName(token.kind)}
            data-scoutql-token={token.kind}
          >
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

/**
 * Highlight kind → Tailwind classes. The ts-pattern match is exhaustive, so a
 * new member of `ScoutQlTokenKind` fails typecheck here until this surface
 * decides how to paint it.
 *
 * The class strings are literals rather than being derived from the shared
 * role table in `scoutql-monaco-themes.ts`: Tailwind extracts candidates by
 * scanning source text, so a computed `text-[var(--scout-color-${role})]`
 * would produce no CSS at all. The roles still match the editor theme.
 */
function scoutQlTokenClassName(kind: ScoutQlTokenKind): string {
  return match(kind)
    .with("keyword", () => "font-semibold text-scout-brand")
    .with("aggregate", () => "font-semibold text-[var(--scout-color-chart5)]")
    .with("function", () => "text-[var(--scout-color-chart5)]")
    .with("column", () => "text-scout-ink")
    .with("alias", () => "text-[var(--scout-color-chart7)]")
    .with("source", () => "font-semibold text-scout-focus")
    .with("number", () => "text-[var(--scout-color-chart6)]")
    .with("string", () => "text-[var(--scout-color-chart3)]")
    .with("operator", () => "text-scout-subtle")
    .with("comment", () => "italic text-scout-subtle")
    .with("renderKind", () => "font-semibold text-scout-accent")
    .with("renderOption", () => "text-scout-accent")
    .with("plain", () => "text-scout-ink")
    .with("invalid", () => "text-scout-danger underline decoration-wavy")
    .exhaustive();
}
