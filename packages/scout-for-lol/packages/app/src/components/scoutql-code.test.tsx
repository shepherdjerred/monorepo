import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";

/** The text content of the rendered `<pre>`, with entities decoded. */
function renderedText(markup: string): string {
  return markup
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

/** The `data-scoutql-token` kinds in source order. */
function tokenKinds(markup: string): string[] {
  return [...markup.matchAll(/data-scoutql-token="([^"]+)"/g)].map(
    (found) => found[1] ?? "",
  );
}

describe("ScoutQlCode", () => {
  const query = [
    "-- weekly ranked win rate",
    "SELECT AVG(win::INT) AS win_rate",
    "FROM match_participants",
    "WHERE queue IN ('solo')",
    "GROUP BY player",
    "RENDER bar_chart WITH (y = win_rate)",
  ].join("\n");

  test("reproduces the query byte for byte", () => {
    const markup = renderToStaticMarkup(<ScoutQlCode queryText={query} />);
    expect(renderedText(markup)).toBe(query);
  });

  test("paints each kind with its own design-system class", () => {
    const markup = renderToStaticMarkup(<ScoutQlCode queryText={query} />);
    const kinds = new Set(tokenKinds(markup));

    expect(kinds).toContain("keyword");
    expect(kinds).toContain("aggregate");
    expect(kinds).toContain("source");
    expect(kinds).toContain("string");
    expect(kinds).toContain("comment");
    expect(kinds).toContain("renderKind");

    expect(markup).toContain(
      '<span class="font-semibold text-scout-brand" data-scoutql-token="keyword">SELECT</span>',
    );
    expect(markup).toContain(
      '<span class="font-semibold text-[var(--scout-color-chart5)]" data-scoutql-token="aggregate">AVG</span>',
    );
    expect(markup).toContain(
      '<span class="font-semibold text-scout-focus" data-scoutql-token="source">match_participants</span>',
    );
    expect(markup).toContain(
      '<span class="italic text-scout-subtle" data-scoutql-token="comment">-- weekly ranked win rate</span>',
    );
    expect(markup).toContain(
      '<span class="font-semibold text-scout-accent" data-scoutql-token="renderKind">bar_chart</span>',
    );
  });

  test("keeps a malformed query intact and marks its unmatched text", () => {
    const broken = "SELECT @@ FROM ???";
    const markup = renderToStaticMarkup(<ScoutQlCode queryText={broken} />);
    expect(renderedText(markup)).toBe(broken);
    expect(tokenKinds(markup)).toContain("invalid");
    expect(markup).toContain("underline decoration-wavy");
  });

  test("renders an empty query without crashing", () => {
    const markup = renderToStaticMarkup(<ScoutQlCode queryText="" />);
    expect(renderedText(markup)).toBe("");
  });
});
