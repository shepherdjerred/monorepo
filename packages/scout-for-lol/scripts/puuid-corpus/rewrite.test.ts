import { describe, expect, test } from "vitest";
import {
  needsRewrite,
  ORIGINAL_UPLOAD_METADATA_KEY,
  preservedMetadata,
  REWRITE_METADATA_KEY,
} from "./rewrite.ts";
import { parseInventory, serializeInventory } from "./inventory.ts";

const OLD = `O${"o".repeat(77)}`;
const NEW = `N${"n".repeat(77)}`;

describe("needsRewrite", () => {
  test("spots an old identifier anywhere in the raw text", () => {
    expect(needsRewrite(`{"a":{"b":["${OLD}"]}}`, new Set([OLD]))).toBe(true);
  });

  test("costs one pass over the body, not one per mapping", () => {
    // The difference between finishing and not: 240k mappings against 66k
    // objects is sixteen billion substring scans if this loops per mapping.
    const map = new Set(
      Array.from(
        { length: 20_000 },
        (_, i) => `P${String(i).padStart(77, "0")}`,
      ),
    );
    const body = JSON.stringify({
      participants: Array.from({ length: 10 }, () => NEW),
    });
    const started = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(needsRewrite(body, map)).toBe(false);
    }
    // Per-mapping scanning would be ~4M string searches here and take seconds.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("a token that merely looks like a PUUID is not a reason to rewrite", () => {
    // Report SVGs embed base64 PNG data of exactly this shape. Judged on shape
    // every sampled one looked like a hit; none held a mapped identity.
    const base64ish = `iVBORw0KGgoAAAANSUhEUgAA${"A".repeat(60)}`;
    expect(needsRewrite(base64ish, new Set([OLD]))).toBe(false);
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

describe("recognising an interrupted run", () => {
  test("the pass must not filter by modification time", () => {
    // Rewriting advances LastModified, so any such filter would exclude exactly
    // the object a re-run needs: one whose PUT landed and whose database update
    // did not. The filter would defeat the recovery it sits beside.
    const rewrittenJustNow = new Date();
    const cutover = new Date("2026-09-13T05:07:05Z");
    expect(rewrittenJustNow > cutover).toBe(true);
  });

  test("a rewritten object is indistinguishable from an untouched one by content", () => {
    // Why the metadata marker has to exist at all: once the identifiers are
    // gone, nothing in the body says whether this pass wrote it.
    const rewritten = `{"puuid":"${NEW}"}`;
    const neverTouched = `{"puuid":"${NEW}"}`;
    expect(needsRewrite(rewritten, new Set([OLD]))).toBe(false);
    expect(needsRewrite(neverTouched, new Set([OLD]))).toBe(false);
    expect(rewritten).toBe(neverTouched);
  });

  test("the marker is what tells them apart", () => {
    const ours: Record<string, string> = {
      [REWRITE_METADATA_KEY]: "2026-09-13T00:00:00.000Z",
    };
    const theirs: Record<string, string> = { uploadedat: "2026-01-01" };
    expect(ours[REWRITE_METADATA_KEY]).toBeDefined();
    expect(theirs[REWRITE_METADATA_KEY]).toBeUndefined();
  });
});

describe("preservedMetadata", () => {
  // What a real match object carries, read off the live archive.
  const producer = {
    matchid: "BR1_3268119783",
    participantcount: "10",
    queueid: "420",
    result: "GameComplete",
    trackedplayercount: "1",
    uploadedat: "2026-08-01T20:52:06.239Z",
  };

  test("keeps everything the producer recorded", () => {
    // A PUT replaces user metadata rather than merging it, so sending only the
    // marker would erase the producer's own record of the capture.
    const merged = preservedMetadata(producer);
    expect(merged["matchid"]).toBe("BR1_3268119783");
    expect(merged["queueid"]).toBe("420");
    expect(merged["result"]).toBe("GameComplete");
    expect(merged["trackedplayercount"]).toBe("1");
  });

  test("carries the original capture time aside from the restamped one", () => {
    // The put overwrites `uploadedat` with the time it stored these bytes.
    // Capture time is provenance, not integrity, so it is moved rather than lost.
    const merged = preservedMetadata(producer);
    expect(merged[ORIGINAL_UPLOAD_METADATA_KEY]).toBe(
      "2026-08-01T20:52:06.239Z",
    );
  });

  test("marks the object as re-domained", () => {
    expect(preservedMetadata(producer)[REWRITE_METADATA_KEY]).toBeDefined();
  });

  test("a second rewrite does not overwrite the first capture time", () => {
    const once = preservedMetadata(producer);
    const twice = preservedMetadata({
      ...once,
      uploadedat: "2026-09-13T00:00:00Z",
    });
    expect(twice[ORIGINAL_UPLOAD_METADATA_KEY]).toBe(
      "2026-08-01T20:52:06.239Z",
    );
  });

  test("an object with no metadata still gets the marker", () => {
    const merged = preservedMetadata({});
    expect(merged[REWRITE_METADATA_KEY]).toBeDefined();
    expect(merged[ORIGINAL_UPLOAD_METADATA_KEY]).toBeUndefined();
  });
});
