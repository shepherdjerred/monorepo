import { expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  BridgeRawDocumentLakeRowSchema,
  layoutFingerprint,
  matchColumns,
  reportLakeLayout,
  rawDocumentColumns,
  bridgeRawDocumentRow,
} from "#src/report-lake/schema-upgrade/layout.ts";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

const row = rawDocumentRow({
  kind: "match",
  matchId: RiotMatchIdSchema.parse("NA1_42"),
  capturedAt: new Date("2026-10-08T00:00:00Z"),
  document: { puuid: "canonical" },
});

test("emits an empty legacy wire map without changing canonical JSON", () => {
  const wire = bridgeRawDocumentRow(row);
  expect(wire.identity_map_json).toBe("{}");
  expect(wire.document_json).toBe(row.document_json);
  expect(BridgeRawDocumentLakeRowSchema.parse(wire)).toEqual(row);
});

test("recognizes only the exact published physical contracts", () => {
  expect(layoutFingerprint("current")).toBe(lakeSchemaFingerprint());
  expect(reportLakeLayout(layoutFingerprint("current"))).toBe("current");
  expect(reportLakeLayout(layoutFingerprint("legacy-identity-map"))).toBe(
    "legacy-identity-map",
  );
  // Prod's last pre-bridge build predates matches.data_source but still has
  // raw_documents.identity_map_json. This literal is read from its published
  // manifest; the exact layout is independently reconstructed above.
  expect(layoutFingerprint("legacy-identity-map-pre-data-source")).toBe(
    "1a45b23ce7f086cb",
  );
  expect(reportLakeLayout("1a45b23ce7f086cb")).toBe(
    "legacy-identity-map-pre-data-source",
  );
  expect(
    matchColumns("legacy-identity-map-pre-data-source"),
  ).not.toHaveProperty("data_source");
  expect(matchColumns("legacy-identity-map")).toHaveProperty(
    "data_source",
    "VARCHAR",
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
