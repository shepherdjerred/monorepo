import { describe, expect, test } from "vitest";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";
import {
  RAW_ARCHIVE_EVIDENCE_VERSION,
  buildReceipt,
  rawArchiveDescriptorOf,
  rawArchiveEvidenceCodec,
  rawArchiveEvidenceOf,
  rawArchiveReceiptKind,
  rawArchiveReceiptRecord,
} from "#src/report-lake/durable-receipts.ts";

/**
 * The raw-archive evidence's replay identity.
 *
 * The property under test is evidence sufficiency: what a receipt compares on
 * replay must be exactly the artifact's identity, so two attestations of the
 * same bytes agree whenever they were stamped, and a version-1 row written
 * before the capture instant left the evidence still reads as version 1 wrote
 * it.
 */

const MATCH_ID = RiotMatchIdSchema.parse("NA1_7001");

function descriptorCapturedAt(capturedAt: string): ArtifactDescriptor {
  return ArtifactDescriptorSchema.parse({
    kind: "match",
    key: "games/2026/09/13/NA1_7001/match.json",
    digest: "c".repeat(64),
    bytes: 4096,
    contentType: "application/json",
    capturedAt,
  });
}

/** A row exactly as the version-1 door wrote it: the whole descriptor. */
function versionOneRow(
  artifact: ArtifactDescriptor,
): MatchProcessingReceiptRecord {
  return buildReceipt({
    matchId: MATCH_ID,
    kind: rawArchiveReceiptKind(artifact.kind),
    evidence: { kind: "raw-archive-evidence", version: 1, data: artifact },
    // Version 1 stamped the receipt from its own clock, after the put.
    recordedAt: new Date("2026-09-13T10:00:00.250Z"),
  });
}

describe("raw-archive evidence", () => {
  test("names the artifact by identity alone", () => {
    const artifact = descriptorCapturedAt("2026-09-13T10:00:00.000Z");

    const evidence = rawArchiveEvidenceCodec.serialize(
      rawArchiveEvidenceOf(artifact),
    );

    expect(evidence.version).toBe(RAW_ARCHIVE_EVIDENCE_VERSION);
    expect(evidence.data).toEqual({
      kind: "match",
      key: artifact.key,
      digest: artifact.digest,
      bytes: 4096,
      contentType: "application/json",
    });
    expect(evidence.data).not.toHaveProperty("capturedAt");
  });

  test("two attestations of the same bytes carry identical evidence", () => {
    // The whole point: the capture instant is observational, and a rival that
    // archived the same object a moment later must not read as drift.
    const first = rawArchiveReceiptRecord({
      matchId: MATCH_ID,
      artifact: descriptorCapturedAt("2026-09-13T10:00:00.000Z"),
    });
    const second = rawArchiveReceiptRecord({
      matchId: MATCH_ID,
      artifact: descriptorCapturedAt("2026-09-13T10:00:00.750Z"),
    });

    expect(second.evidence).toBe(first.evidence);
    expect(second.receipt.recordedAt).not.toBe(first.receipt.recordedAt);
  });

  test("keeps the capture instant as the receipt's recordedAt and round-trips it", () => {
    const artifact = descriptorCapturedAt("2026-09-13T10:00:00.000Z");

    const record = rawArchiveReceiptRecord({ matchId: MATCH_ID, artifact });

    expect(record.receipt.recordedAt).toBe(artifact.capturedAt);
    expect(rawArchiveDescriptorOf(record)).toEqual(artifact);
  });

  test("reads a version-1 row's capture instant from its own evidence", () => {
    // Beta holds rows written this way. Their capture instant is in the
    // evidence, and the receipt's recordedAt is a later, different clock
    // reading — so a reader that took recordedAt for every version would
    // quietly re-date every old artifact.
    const artifact = descriptorCapturedAt("2026-09-13T10:00:00.000Z");

    const restored = rawArchiveDescriptorOf(versionOneRow(artifact));

    expect(restored).toEqual(artifact);
    expect(restored.capturedAt).toBe(
      IsoInstantSchema.parse("2026-09-13T10:00:00.000Z"),
    );
  });

  test("migrates a version-1 envelope to the identity the current version compares", () => {
    const artifact = descriptorCapturedAt("2026-09-13T10:00:00.000Z");

    expect(
      rawArchiveEvidenceCodec.parse({
        kind: "raw-archive-evidence",
        version: 1,
        data: artifact,
      }),
    ).toEqual(rawArchiveEvidenceOf(artifact));
  });

  test("rejects a version-1 row that does not satisfy version 1's own shape", () => {
    // Old rows are validated as what they claim to be before being narrowed,
    // so a corrupt version-1 payload fails as version 1 rather than slipping
    // through a narrower schema that happens not to look at the broken field.
    const { capturedAt: _capturedAt, ...withoutCaptureInstant } =
      descriptorCapturedAt("2026-09-13T10:00:00.000Z");

    expect(() =>
      rawArchiveEvidenceCodec.parse({
        kind: "raw-archive-evidence",
        version: 1,
        data: withoutCaptureInstant,
      }),
    ).toThrow();
  });

  test("rejects current-version evidence that still carries a capture instant", () => {
    // A writer that put the instant back into the evidence would reopen the
    // identity drift this version exists to close.
    expect(() =>
      rawArchiveEvidenceCodec.parse({
        kind: "raw-archive-evidence",
        version: RAW_ARCHIVE_EVIDENCE_VERSION,
        data: descriptorCapturedAt("2026-09-13T10:00:00.000Z"),
      }),
    ).toThrow();
  });
});
