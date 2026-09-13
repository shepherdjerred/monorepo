import { describe, expect, test } from "vitest";
import { needsRewrite, writtenAfterCutover } from "./rewrite.ts";
import { parseInventory, serializeInventory } from "./inventory.ts";

const OLD = `O${"o".repeat(77)}`;
const NEW = `N${"n".repeat(77)}`;

describe("needsRewrite", () => {
  test("spots an old identifier anywhere in the raw text", () => {
    // Deliberately a substring test on the unparsed body: parsing 61 GiB to
    // discover most documents need no change would dominate the run.
    expect(needsRewrite(`{"a":{"b":["${OLD}"]}}`, new Set([OLD]))).toBe(true);
  });

  test("leaves a document that names nobody we are moving", () => {
    expect(needsRewrite(`{"puuid":"${NEW}"}`, new Set([OLD]))).toBe(false);
  });

  test("an already-rewritten document is skipped, which is what makes re-runs safe", () => {
    const body = `{"puuid":"${OLD}"}`;
    const rewritten = body.replaceAll(OLD, NEW);
    expect(needsRewrite(rewritten, new Set([OLD]))).toBe(false);
  });

  test("an empty map rewrites nothing", () => {
    expect(needsRewrite(`{"puuid":"${OLD}"}`, new Set())).toBe(false);
  });
});

describe("writtenAfterCutover", () => {
  const cutover = new Date("2026-09-13T05:07:05Z");
  const object = (iso: string | undefined) => ({
    key: "games/x/match.json",
    kind: "match" as const,
    lastModified: iso === undefined ? undefined : new Date(iso),
  });

  test("skips an object written under the production key", () => {
    expect(writtenAfterCutover(object("2026-09-13T06:00:00Z"), cutover)).toBe(
      true,
    );
  });

  test("keeps an object written before the swap", () => {
    expect(writtenAfterCutover(object("2026-09-13T04:00:00Z"), cutover)).toBe(
      false,
    );
  });

  test("keeps an object with no timestamp rather than assuming it is new", () => {
    expect(writtenAfterCutover(object(undefined), cutover)).toBe(false);
  });

  test("keeps everything when no cutover is given", () => {
    expect(writtenAfterCutover(object("2030-01-01T00:00:00Z"), undefined)).toBe(
      false,
    );
  });
});

describe("inventory round trip", () => {
  test("survives serialize and parse unchanged", () => {
    const rows = [
      { oldPuuid: OLD, archivedRiotId: "Shen ra#8062" },
      { oldPuuid: NEW, archivedRiotId: null },
    ];
    expect(parseInventory(serializeInventory(rows))).toEqual(rows);
  });

  test("tolerates a trailing newline and blank lines", () => {
    const text = `{"oldPuuid":"${OLD}","archivedRiotId":null}\n\n`;
    expect(parseInventory(text)).toEqual([
      { oldPuuid: OLD, archivedRiotId: null },
    ]);
  });

  test("refuses a line with no identity rather than dropping it", () => {
    // A silently skipped line is an identity that never gets migrated.
    expect(() => parseInventory(`{"archivedRiotId":"A#B"}`)).toThrow(
      /no oldPuuid/,
    );
    expect(() => parseInventory(`["not","an","object"]`)).toThrow(
      /not an object/,
    );
  });
});
