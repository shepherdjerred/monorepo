import {
  highlightReportQuery,
  type ReportQueryHighlightKind,
} from "@scout-for-lol/data";

export function ScoutQlCode(props: { queryText: string; className?: string }) {
  const tokens = highlightReportQuery(props.queryText);
  return (
    <pre
      className={`overflow-x-auto rounded-md border border-scout-border bg-scout-hover/50 p-3 font-mono text-xs leading-5 ${props.className ?? ""}`}
    >
      <code>
        {tokens.map((token, index) => (
          <span
            key={`${String(index)}-${token.kind}`}
            className={highlightClassName(token.kind)}
            data-scoutql-token={token.kind}
          >
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

function highlightClassName(kind: ReportQueryHighlightKind): string {
  if (kind === "keyword") {
    return "font-semibold text-scout-brand";
  }
  if (kind === "string") {
    return "text-scout-success";
  }
  if (kind === "number") {
    return "text-scout-accent";
  }
  if (kind === "operator") {
    return "text-scout-subtle";
  }
  return "text-scout-ink";
}
