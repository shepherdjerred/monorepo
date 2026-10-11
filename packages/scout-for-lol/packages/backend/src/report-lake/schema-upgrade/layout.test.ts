import { expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  BridgeRawDocumentLakeRowSchema,
  layoutFingerprint,
  reportLakeLayout,
  rawDocumentColumns,
} from "#src/report-lake/schema-upgrade/layout.ts";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

const row = rawDocumentRow({
  kind: "match",
  matchId: RiotMatchIdSchema.parse("NA1_42"),
  capturedAt: new Date("2026-10-08T00:00:00Z"),
  document: { puuid: "canonical" },
});

test("recognizes only the two exact physical contracts", () => {
  expect(layoutFingerprint("current")).toBe(lakeSchemaFingerprint());
  expect(reportLakeLayout(layoutFingerprint("current"))).toBe("current");
  expect(reportLakeLayout(layoutFingerprint("legacy-identity-map"))).toBe(
    "legacy-identity-map",
  );
  expect(reportLakeLayout(undefined)).toBeUndefined();
  expect(reportLakeLayout("unexpected-schema")).toBeUndefined();
  expect(rawDocumentColumns("current")).not.toHaveProperty("identity_map_json");
  expect(rawDocumentColumns("legacy-identity-map")).toHaveProperty(
    "identity_map_json",
    "VARCHAR",
  );
});

test("accepts known old metadata but never uses it to translate canonical JSON", () => {
  const old = {
    ...row,
    identity_map_json: '{"canonical":"must-not-translate"}',
  };
  expect(BridgeRawDocumentLakeRowSchema.parse(old)).toEqual(row);
  expect(BridgeRawDocumentLakeRowSchema.parse(row)).toEqual(row);
  expect(
    BridgeRawDocumentLakeRowSchema.safeParse({ ...old, unexpected: true })
      .success,
  ).toBe(false);
  expect(
    BridgeRawDocumentLakeRowSchema.safeParse({ ...row, identity_map_json: 42 })
      .success,
  ).toBe(false);
});
