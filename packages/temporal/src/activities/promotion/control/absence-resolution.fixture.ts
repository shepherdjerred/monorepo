import { createHash } from "node:crypto";
import type { z } from "zod/v4";
import {
  PromotionAbsenceEvidenceSchema,
  PROMOTION_ABSENCE_ATTESTATION,
} from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";
import {
  initialPromotionState,
  type PromotionTarget,
} from "#shared/promotion/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { resolvePromotionAbsence } from "./absence-resolution.ts";

export const originalRun = "00000000-0000-4000-8000-000000000001";
export const latestRun = "00000000-0000-4000-8000-000000000002";
export const resolutionId = "00000000-0000-4000-8000-000000000003";
export const target: PromotionTarget = {
  id: "fixture",
  name: "Fixture",
  url: "https://example.com/servers/fixture",
  rulesUrl: "https://example.com/",
  account: "fixture",
  hosts: ["example.com"],
  action: "bump",
  content: "directory",
  notes: "Synthetic operator-resolution fixture",
  minimumIntervalSeconds: 28_800,
};
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function fixture() {
  const facts = PromotionAbsenceEvidenceSchema.parse({
    version: 1,
    namespace: "prod",
    targetId: target.id,
    action: "bump",
    originalOccurrenceId: `storm-promotion/fixture/${originalRun}`,
    attemptedAt: "2026-01-01T12:00:00.000Z",
    contentHash: "a".repeat(64),
    entity: {
      id: "fixture-public-id",
      name: "Fixture",
      slug: "fixture",
      url: target.url,
    },
    observation: {
      pageUrl: "https://example.com/dashboard",
      observedAt: "2026-01-01T12:03:00.000Z",
      basis: "last-bump-watermark",
      field: "last_bumped_at",
      lastActionAt: "2025-12-31T12:00:00.000Z",
      artifacts: [
        {
          kind: "official-source",
          url: "https://example.com/official.js",
          sha256: "b".repeat(64),
        },
        { kind: "scoped-observation", sha256: "c".repeat(64) },
      ],
    },
    review: {
      reference: "AI365",
      attestation: PROMOTION_ABSENCE_ATTESTATION,
    },
  });
  const state = initialPromotionState(target.id, 1000);
  state.lock = {
    occurrenceId: `storm-promotion/fixture/${latestRun}`,
    acquiredAt: "2026-01-01T12:01:00.000Z",
  };
  state.blockedReason =
    "Submission outcome uncertain; reconcile the remote result";
  state.executionHealth = {
    consecutiveFailures: 1,
    lastOccurrenceId: facts.originalOccurrenceId,
  };
  state.attempts.push({
    occurrenceId: facts.originalOccurrenceId,
    attemptedAt: facts.attemptedAt,
    contentHash: facts.contentHash,
    settledAt: null,
    status: "uncertain",
    receiptUrl: null,
    evidenceKey: null,
    beforeSubmission: [],
  });
  const rows = new Map<string, { value: unknown; etag: string }>([
    ["targets/fixture.json", { value: state, etag: '"reviewed"' }],
  ]);
  const writes: { key: string; etag: string | undefined }[] = [];
  let conflict = false;
  const store: PromotionStore = {
    read: <T>(key: string, schema: z.ZodType<T>) => {
      const row = rows.get(key);
      return Promise.resolve(
        row === undefined
          ? undefined
          : { value: schema.parse(structuredClone(row.value)), etag: row.etag },
      );
    },
    put: (key, value, etag) => {
      writes.push({ key, etag });
      if (
        (conflict && key.startsWith("targets/")) ||
        rows.get(key)?.etag !== etag
      )
        return Promise.resolve(false);
      rows.set(key, {
        value: structuredClone(value),
        etag: `"v${String(writes.length)}"`,
      });
      return Promise.resolve(true);
    },
  };
  const evidenceJson = JSON.stringify(facts);
  const request = {
    operation: "resolve-absence",
    namespace: "prod",
    targetId: "fixture",
    resolutionId,
    expectedStateEtag: '"reviewed"',
    evidenceJson,
    evidenceSha256: hash(evidenceJson),
    apply: false,
  };
  const owner = {
    status: "COMPLETED",
    type: "runStormPromotion",
    closedAt: "2026-01-01T12:02:00.000Z",
  };
  const ownerOverrides = new Map<string, Partial<typeof owner>>();
  const reads: string[] = [];
  const execute = (overrides: Partial<typeof request> = {}) =>
    resolvePromotionAbsence({
      request: { ...request, ...overrides },
      namespace: "prod",
      target,
      store,
      now: () => Date.parse("2026-01-01T12:04:00.000Z"),
      readOwner: (workflowId, runId) => {
        reads.push(runId ?? "latest");
        return Promise.resolve({
          ...owner,
          ...ownerOverrides.get(runId ?? "latest"),
          workflowId,
          runId: runId ?? latestRun,
        });
      },
    });
  return {
    facts,
    request,
    state,
    rows,
    writes,
    reads,
    owner,
    ownerOverrides,
    execute,
    store,
    conflict: () => {
      conflict = true;
    },
  };
}
