import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";
import { RawDocumentLakeRowSchema } from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";

const capturedAt = new Date("2026-10-08T00:00:00Z");

test("preserves nested canonical values and keys without identity metadata", () => {
  const document = {
    participants: ["current-player", { puuid: "current-player" }],
    "current-key": null,
    unrelated: [false, 42, 'escaped-"player雪'],
  };
  const row = rawDocumentRow({
    kind: "match",
    matchId: RiotMatchIdSchema.parse("NA1_42"),
    capturedAt,
    document,
  });
  expect(row).not.toHaveProperty("identity_map_json");
  expect(row.document_json).toBe(JSON.stringify(document));
  expect(row.source_digest).toBe(
    createHash("sha256").update(JSON.stringify(document)).digest("hex"),
  );
  expect(
    RawDocumentLakeRowSchema.safeParse({ ...row, identity_map_json: "{}" })
      .success,
  ).toBe(false);
});

test("scrubs spectator credentials without mutating canonical input or provenance", () => {
  const document = {
    observers: { encryptionKey: "fixture-credential" },
    participants: [{ puuid: "current-player" }],
    captured: capturedAt,
    omitted: undefined,
  };
  const row = rawDocumentRow({
    kind: "prematch",
    matchId: RiotMatchIdSchema.parse("NA1_42"),
    capturedAt,
    document,
    source: {
      kind: "s3",
      key: "prematch/NA1_42/spectator-data.json",
      digest: "canonical-digest",
    },
  });
  expect(JSON.parse(row.document_json)).toEqual({
    participants: [{ puuid: "current-player" }],
    captured: capturedAt.toISOString(),
  });
  expect(document.observers.encryptionKey).toBe("fixture-credential");
  expect(row.source_digest).toBe("canonical-digest");
  expect(row).not.toHaveProperty("identity_map_json");
});
