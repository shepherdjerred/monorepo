import { expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";

const capturedAt = new Date("2026-10-08T00:00:00Z");

test("records only identities present in nested values and keys without rewriting raw JSON", () => {
  const document = {
    participants: ["old-player", { puuid: "old-player" }],
    "old-key": null,
    unrelated: [false, 42, "prefix-old-missing", 'prefix"old-missing'],
  };
  const row = rawDocumentRow({
    kind: "match",
    matchId: "NA1_42",
    capturedAt,
    document,
    identityMap: new Map([
      ["old-missing", "new-missing"],
      ["old-key", "new-key"],
      ["old-player", "new-player"],
    ]),
  });
  expect(JSON.parse(row.identity_map_json)).toEqual({
    "old-player": "new-player",
    "old-key": "new-key",
  });
  expect(row.document_json).toBe(JSON.stringify(document));
  expect(row.source_digest).toBe(
    createHash("sha256").update(JSON.stringify(document)).digest("hex"),
  );
});

test("collects mappings after spectator credential removal and JSON conversion", () => {
  const document = {
    observers: { encryptionKey: "secret-identity" },
    participants: [{ puuid: "old-player" }],
    captured: capturedAt,
    omitted: undefined,
  };
  const row = rawDocumentRow({
    kind: "prematch",
    matchId: "NA1_42",
    capturedAt,
    document,
    source: {
      kind: "s3",
      key: "prematch/NA1_42/spectator-data.json",
      digest: "canonical-digest",
    },
    identityMap: new Map([
      ["secret-identity", "must-not-persist"],
      ["old-player", "new-player"],
      [capturedAt.toISOString(), "serialized-date"],
    ]),
  });
  expect(JSON.parse(row.identity_map_json)).toEqual({
    "old-player": "new-player",
    [capturedAt.toISOString()]: "serialized-date",
  });
  expect(JSON.parse(row.document_json)).toEqual({
    participants: [{ puuid: "old-player" }],
    captured: capturedAt.toISOString(),
  });
  expect(document.observers.encryptionKey).toBe("secret-identity");
  expect(row.source_digest).toBe("canonical-digest");
});

test("handles escaped identities and an omitted identity map", () => {
  const document = { participant: String.raw`old-"player\雪` };
  const input = {
    kind: "timeline" as const,
    matchId: "NA1_42",
    capturedAt,
    document,
  };
  expect(rawDocumentRow(input).identity_map_json).toBe("{}");
  expect(
    rawDocumentRow({ ...input, identityMap: new Map() }).identity_map_json,
  ).toBe("{}");
  const row = rawDocumentRow({
    ...input,
    identityMap: new Map([[document.participant, "new-player"]]),
  });
  expect(JSON.parse(row.identity_map_json)).toEqual({
    [document.participant]: "new-player",
  });
});

test("a large migration map requires lookups only for document strings", () => {
  const identities = new Map<string, string>();
  for (let index = 0; index < 285_145; index += 1) {
    identities.set(`old-${index.toString()}`, `new-${index.toString()}`);
  }
  const iterate = vi.spyOn(identities, Symbol.iterator);
  const row = rawDocumentRow({
    kind: "match",
    matchId: "NA1_42",
    capturedAt,
    document: { participants: ["old-12", "old-284000"] },
    identityMap: identities,
  });
  expect(JSON.parse(row.identity_map_json)).toEqual({
    "old-12": "new-12",
    "old-284000": "new-284000",
  });
  expect(iterate).not.toHaveBeenCalled();
});
