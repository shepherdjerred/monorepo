import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  PromotionAbsenceEvidenceSchema,
  PromotionAbsenceResolutionSchema,
  type PromotionAbsenceResolution,
  type PromotionAbsenceEvidence,
} from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";
import {
  assertPromotionUrl,
  PromotionStateSchema,
  type PromotionState,
  type PromotionTarget,
  type PromotionAttempt,
} from "#shared/promotion/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const ClosedOwner = z.strictObject({
  occurrenceId: z.string(),
  closedAt: z.iso.datetime(),
});
const Audit = z.strictObject({
  version: z.literal(1),
  decision: z.literal("operator-attested-no-action"),
  resolutionId: z.uuid(),
  targetId: z.string(),
  expectedStateEtag: z.string(),
  evidenceSha256: z.string(),
  evidenceJson: z.string(),
  preparedAt: z.iso.datetime(),
  closedOwners: z.array(ClosedOwner),
});
type OwnerRead = (
  workflowId: string,
  runId?: string,
) => Promise<{
  workflowId: string;
  runId: string;
  type: string;
  status: string;
  closedAt: string | null;
}>;

function evidence(
  input: PromotionAbsenceResolution,
  target: PromotionTarget,
  expectedNamespace: string,
) {
  if (sha256(input.evidenceJson) !== input.evidenceSha256)
    throw new Error("Absence evidence digest mismatch");
  let json: unknown;
  try {
    json = JSON.parse(input.evidenceJson);
  } catch {
    throw new Error("Invalid absence evidence JSON");
  }
  const parsed = PromotionAbsenceEvidenceSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid absence evidence schema");
  const value = parsed.data;
  if (
    value.namespace !== expectedNamespace ||
    value.targetId !== input.targetId ||
    target.id !== input.targetId ||
    target.action !== "bump" ||
    target.discord !== undefined ||
    value.entity.url !== target.url ||
    value.entity.slug !==
      new URL(target.url).pathname.split("/").findLast(Boolean)
  )
    throw new Error("Absence evidence target or entity URL mismatch");
  assertPromotionUrl(target, value.observation.pageUrl);
  for (const artifact of value.observation.artifacts)
    if (artifact.kind === "official-source")
      assertPromotionUrl(target, artifact.url);
  if (
    Date.parse(value.observation.lastActionAt) >=
      Date.parse(value.attemptedAt) ||
    Date.parse(value.observation.observedAt) <= Date.parse(value.attemptedAt)
  )
    throw new Error("Absence watermark does not predate the original attempt");
  return value;
}

async function closedOwners(
  input: PromotionAbsenceResolution,
  state: PromotionState,
  original: string,
  readOwner: OwnerRead,
) {
  const workflowId = `storm-promotion/${input.targetId}`;
  const prefix = `${workflowId}/`;
  const latest = await readOwner(workflowId);
  const occurrences = new Set([original, `${prefix}${latest.runId}`]);
  if (state.lock !== null) occurrences.add(state.lock.occurrenceId);
  const result = [];
  for (const occurrenceId of occurrences) {
    if (
      !occurrenceId.startsWith(prefix) ||
      !z.uuid().safeParse(occurrenceId.slice(prefix.length)).success
    )
      throw new Error("Absence resolution owner identity mismatch");
    const runId = occurrenceId.slice(prefix.length);
    const owner =
      occurrenceId === `${prefix}${latest.runId}`
        ? latest
        : await readOwner(workflowId, runId);
    if (
      owner.workflowId !== workflowId ||
      owner.runId !== runId ||
      owner.type !== "runStormPromotion" ||
      ![
        "COMPLETED",
        "FAILED",
        "TIMED_OUT",
        "CANCELLED",
        "TERMINATED",
        "CONTINUED_AS_NEW",
      ].includes(owner.status) ||
      owner.closedAt === null ||
      !z.iso.datetime().safeParse(owner.closedAt).success
    )
      throw new Error(
        "Absence resolution requires closed original and latest owners",
      );
    result.push({ occurrenceId, closedAt: owner.closedAt });
  }
  return result;
}

function originalAttempt(
  state: PromotionState,
  facts: PromotionAbsenceEvidence,
) {
  const matching = state.attempts.filter(
    (a) => a.occurrenceId === facts.originalOccurrenceId,
  );
  const attempt = matching[0];
  if (
    matching.length !== 1 ||
    attempt?.attemptedAt !== facts.attemptedAt ||
    attempt.contentHash !== facts.contentHash
  )
    throw new Error("Absence resolution original attempt mismatch");
  return attempt;
}

function committedResolution(
  request: PromotionAbsenceResolution,
  attempt: PromotionAttempt,
  audit: z.infer<typeof Audit> | undefined,
  auditKey: string,
) {
  const marker = attempt.operatorResolution;
  if (marker === undefined) return false;
  if (
    audit === undefined ||
    attempt.status !== "no-action" ||
    attempt.settledAt === null ||
    marker.resolutionId !== request.resolutionId ||
    marker.evidenceSha256 !== request.evidenceSha256 ||
    marker.auditKey !== auditKey ||
    marker.auditSha256 !== sha256(JSON.stringify(audit)) ||
    audit.evidenceJson !== request.evidenceJson ||
    (request.expectedStateEtag !== undefined &&
      request.expectedStateEtag !== audit.expectedStateEtag)
  )
    throw new Error(
      "Absence resolution readback does not match committed evidence",
    );
  return true;
}

function assertPreparedAudit(
  audit: z.infer<typeof Audit>,
  request: PromotionAbsenceResolution,
  etag: string,
) {
  if (
    audit.resolutionId !== request.resolutionId ||
    audit.targetId !== request.targetId ||
    audit.expectedStateEtag !== etag ||
    audit.evidenceSha256 !== request.evidenceSha256 ||
    audit.evidenceJson !== request.evidenceJson
  )
    throw new Error(
      "Prepared absence audit differs from the reviewed decision",
    );
}

/** No browser, model, external publication, state initialization, or CAS retries. */
export async function resolvePromotionAbsence(input: {
  request: unknown;
  namespace: string;
  target: PromotionTarget;
  store: PromotionStore;
  readOwner: OwnerRead;
  now: () => number;
}) {
  const parsed = PromotionAbsenceResolutionSchema.safeParse(input.request);
  if (!parsed.success) throw new Error("Invalid absence resolution request");
  const request = parsed.data;
  if (input.namespace !== request.namespace)
    throw new Error("Absence resolution namespace mismatch");
  const facts = evidence(request, input.target, request.namespace);
  if (Date.parse(facts.observation.observedAt) > input.now())
    throw new Error("Absence observation is in the future");
  const key = `targets/${request.targetId}.json`;
  const current = await input.store.read(key, PromotionStateSchema);
  if (current?.value.targetId !== request.targetId)
    throw new Error("Absence resolution target state is missing or mismatched");
  const state = current.value;
  const attempt = originalAttempt(state, facts);
  const auditKey = `absence-resolutions/${request.targetId}/${encodeURIComponent(facts.originalOccurrenceId)}/${request.resolutionId}.json`;
  const oldAudit = await input.store.read(auditKey, Audit);
  if (committedResolution(request, attempt, oldAudit?.value, auditKey)) {
    return {
      status: "already-applied",
      resolutionId: request.resolutionId,
      evidenceSha256: request.evidenceSha256,
      paused: state.paused,
    };
  }
  if (
    attempt.status !== "uncertain" ||
    state.attempts.filter((a) => a.status === "uncertain").length !== 1
  )
    throw new Error(
      "Absence resolution requires exactly one original uncertain attempt",
    );
  if (
    request.expectedStateEtag !== undefined &&
    request.expectedStateEtag !== current.etag
  )
    throw new Error("Absence resolution reviewed state ETag changed");
  const owners = await closedOwners(
    request,
    state,
    facts.originalOccurrenceId,
    input.readOwner,
  );
  if (
    owners.some(
      (o) => Date.parse(o.closedAt) > Date.parse(facts.observation.observedAt),
    )
  )
    throw new Error(
      "Absence observation predates an owning execution's closure",
    );
  const plan = {
    namespace: request.namespace,
    targetId: request.targetId,
    originalOccurrenceId: facts.originalOccurrenceId,
    resolutionId: request.resolutionId,
    expectedStateEtag: current.etag,
    evidenceSha256: request.evidenceSha256,
    decision: "no-action",
    paused: true,
    entity: facts.entity,
    watermark: facts.observation.lastActionAt,
    observedAt: facts.observation.observedAt,
    closedOwners: owners,
  };
  if (oldAudit !== undefined)
    assertPreparedAudit(oldAudit.value, request, current.etag);
  if (!request.apply)
    return { status: "plan", ...plan, prepared: oldAudit !== undefined };
  const audit =
    oldAudit?.value ??
    Audit.parse({
      version: 1,
      decision: "operator-attested-no-action",
      resolutionId: request.resolutionId,
      targetId: request.targetId,
      expectedStateEtag: current.etag,
      evidenceSha256: request.evidenceSha256,
      evidenceJson: request.evidenceJson,
      preparedAt: new Date(input.now()).toISOString(),
      closedOwners: owners,
    });
  assertPreparedAudit(audit, request, current.etag);
  if (
    oldAudit === undefined &&
    !(await input.store.put(auditKey, audit, undefined))
  )
    throw new Error(
      "Absence audit creation conflicted; inspect before continuing",
    );
  const auditSha256 = sha256(JSON.stringify(audit));
  const next = PromotionStateSchema.parse({
    ...state,
    paused: true,
    lock: null,
    blockedReason:
      "Absence resolved by operator; paused pending explicit resume",
    attempts: state.attempts.map((a) =>
      a.occurrenceId === facts.originalOccurrenceId
        ? {
            ...a,
            status: "no-action",
            settledAt: new Date(input.now()).toISOString(),
            receiptUrl: null,
            operatorResolution: {
              resolutionId: request.resolutionId,
              evidenceSha256: request.evidenceSha256,
              auditKey,
              auditSha256,
            },
          }
        : a,
    ),
  });
  if (!(await input.store.put(key, next, current.etag)))
    throw new Error(
      "Absence resolution CAS conflicted; prepared audit is not applied",
    );
  return { status: "applied", ...plan, auditSha256 };
}
