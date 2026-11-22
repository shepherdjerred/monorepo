import { expect, test } from "vitest";
import { BundleReviewSchema } from "#shared/migration-handoff.ts";
import { MigrationDiscoveryResultSchema } from "#shared/migration-catalog.ts";
import {
  MigrationProposalSchema,
  MigrationReportEntrySchema,
  SourceKindSchema,
} from "#shared/migration.ts";
import { DISCOVERY_OUTCOME } from "./discovery.tsx";
import {
  CONFIDENCE,
  ENTRY_STATE,
  RECORD_KINDS,
  REVIEW_STATUS,
  SOURCE_LABELS,
} from "./vocabulary.ts";

function keys(map: object): string[] {
  return Object.keys(map).sort();
}

function options(values: readonly string[]): string[] {
  return [...values].sort();
}

test("every vocabulary map names exactly the values the server's schema allows", () => {
  expect(keys(REVIEW_STATUS)).toEqual(
    options(MigrationProposalSchema.shape.status.options),
  );
  // A report review and a capture review share their statuses.
  expect(keys(REVIEW_STATUS)).toEqual(
    options(BundleReviewSchema.shape.status.options),
  );
  expect(keys(SOURCE_LABELS)).toEqual(options(SourceKindSchema.options));
  expect(keys(RECORD_KINDS)).toEqual(
    options(MigrationReportEntrySchema.shape.kind.options),
  );
  expect(keys(CONFIDENCE)).toEqual(
    options(MigrationReportEntrySchema.shape.confidence.options),
  );
  expect(keys(ENTRY_STATE)).toEqual(
    options(MigrationReportEntrySchema.shape.state.options),
  );
  expect(keys(DISCOVERY_OUTCOME)).toEqual(
    options(
      MigrationDiscoveryResultSchema.shape.entries.element.shape.status.options,
    ),
  );
});
