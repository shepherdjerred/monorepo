/**
 * What a settled recovery intent read back (4.15), read the same way by the
 * deployment page and by every hub page that names why a deployment failed:
 * once an independent reader has settled the intent, what the executor said
 * while the outcome was unknown ("External operation may still be active")
 * is stale, and the readback is what is true.
 */

/** The parts of a recovery intent a reading needs. */
export type ReadableIntent = {
  id: string;
  sequence: number;
  outcome: "pending" | "succeeded" | "failed";
  evidence: readonly { summary: string }[];
};

/**
 * What an independent Application readback names: its Application (first,
 * before a comma), the step's request it read back, and the operation's
 * phase, as `recovery.ts` and `argo-recovery/unsynced.ts` write them.
 */
const READBACK_APPLICATION = /readback(?: \([^)]*\))?: (?<app>[^\s,]+),/u;
const READBACK_REQUEST = /\brequest (?<request>[^\s,]+)/u;
const READBACK_PHASE = /\bphase (?<phase>[A-Z][A-Za-z]*)\b/u;
/** A readback of a deployment that never requested its sync. */
const NO_SYNC = "readback (no sync requested)";

/** Whether a summary is a JSON object: a machine receipt, not a readback in words. */
function isReceipt(summary: string) {
  if (!summary.trimStart().startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(summary);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    // Prose that happens to open with a brace is prose.
    return false;
  }
}

/** One readback a settled recovery intent recorded, with what it names. */
function readback(text: string) {
  const application = READBACK_APPLICATION.exec(text)?.groups?.["app"] ?? null;
  // A deployment that ended before requesting a sync changed nothing: the
  // request and phase its readback names are a prior operation's, so they
  // say nothing of this deployment's work (`argo-recovery/unsynced.ts`).
  if (text.includes(NO_SYNC))
    return { text, application, request: null, phase: null };
  return {
    text,
    application,
    request: READBACK_REQUEST.exec(text)?.groups?.["request"] ?? null,
    phase: READBACK_PHASE.exec(text)?.groups?.["phase"] ?? null,
  };
}

/** The intent recorded last: the one whose outcome stands. */
function newestIntent(intents: readonly ReadableIntent[] | undefined) {
  return (intents ?? []).toSorted(
    (left, right) => right.sequence - left.sequence,
  )[0];
}

/**
 * What the newest recovery intent settled, once it succeeded: which intent,
 * and each readback its independent reader recorded, one per Application of
 * a compound recipe. Null while no intent has settled, or when the newest
 * one failed, because then nothing has read the outcome back.
 */
export function recoveryReading(
  intents: readonly ReadableIntent[] | undefined,
) {
  const intent = newestIntent(intents);
  if (intent?.outcome !== "succeeded") return null;
  return {
    id: intent.id,
    sequence: intent.sequence,
    readbacks: intent.evidence.flatMap((entry) =>
      isReceipt(entry.summary) ? [] : [readback(entry.summary)],
    ),
  };
}

export type RecoveryReading = NonNullable<ReturnType<typeof recoveryReading>>;

/**
 * The phase recovery read back for one step's operation: the readback of
 * that step's own request, or the only readback, when it names no request.
 * Null when no readback, or more than one phase, answers for the step.
 */
export function readbackPhase(
  reading: RecoveryReading,
  stage: { operationId: string },
) {
  const own = reading.readbacks.filter(
    (entry) => entry.request === stage.operationId,
  );
  // A readback that names another step's request never answers for this one.
  const answers =
    own.length > 0
      ? own
      : reading.readbacks.filter((entry) => entry.request === null);
  const phases = new Set(answers.map((entry) => entry.phase));
  const [phase = null] = phases;
  return phases.size === 1 && (own.length > 0 || answers.length === 1)
    ? phase
    : null;
}

/**
 * How the external work ended, by what recovery read back: `failed` when a
 * readback names a phase other than Succeeded, `succeeded` when every
 * readback names Succeeded, and null when some name no phase, so nothing
 * says.
 */
export function readbackOutcome(reading: RecoveryReading) {
  const phases = reading.readbacks.map((entry) => entry.phase);
  if (phases.some((phase) => phase !== null && phase !== "Succeeded"))
    return "failed" as const;
  return phases.length > 0 && phases.every((phase) => phase === "Succeeded")
    ? ("succeeded" as const)
    : null;
}

/**
 * What a settled recovery read back, after its intent's name: one
 * operation's phase, each Application's phase when it read several back, or
 * its words when no readback names a phase.
 */
export function settledWords(settled: RecoveryReading) {
  const phased = settled.readbacks.filter((entry) => entry.phase !== null);
  const [only] = settled.readbacks;
  if (phased.length === 0)
    return only === undefined
      ? " settled what the deployment left running."
      : ` settled what the deployment left running: ${only.text}`;
  if (settled.readbacks.length === 1)
    return ` read the external operation back after the deployment ended: it ended in phase ${String(only?.phase)}.`;
  const each = phased
    .map(
      (entry) =>
        `${entry.application ?? "an operation"} ended in phase ${String(entry.phase)}`,
    )
    .join("; ");
  return ` read each external operation back after the deployment ended: ${each}.`;
}

/** What a page says when no record gives a cause for a failure. */
export const NO_CAUSE = "No cause was recorded";

/** The parts of a step a failure's cause is read from. */
export type CauseStage = { key: string; status: string; message: string };

/**
 * What a step's message adds to its key and status. Executors often write
 * `step-sync: running`, which repeats both, and a message that starts with
 * its own key loses the key. Null when nothing is left.
 */
export function stepMessage(stage: CauseStage) {
  const prefix = `${stage.key}: `;
  const text = (
    stage.message.startsWith(prefix)
      ? stage.message.slice(prefix.length)
      : stage.message
  ).trim();
  return text === "" || text === stage.status ? null : text;
}

/**
 * The cause the steps record for an ended deployment: the step that failed
 * and what it said, or else the step still running when the deployment
 * ended, whose outcome nothing reported. Null when no step says anything.
 */
export function stageCause(stages: readonly CauseStage[]) {
  const failed = stages.find((stage) => stage.status === "failed");
  if (failed !== undefined) {
    const words = stepMessage(failed);
    return words === null
      ? `Step ${failed.key} failed`
      : `Step ${failed.key} failed: ${words}`;
  }
  const running = stages.find((stage) => stage.status === "running");
  return running === undefined
    ? null
    : `Step ${running.key} was still running when the deployment ended`;
}

/**
 * Why a failed deployment failed, as a page states it: what recovery read
 * back once the newest recovery intent has settled and the lock is released,
 * and otherwise what the executor recorded. While an intent is pending, or
 * the deployment still holds its lock, the executor's words stand: the
 * outcome is still unknown.
 *
 * A readback of Succeeded says the external work finished, which never
 * explains a failure: the cause is then the step the deployment ended on,
 * or that none was recorded.
 */
export function failureReason(
  deployment: { message: string | null; recoveryRequired: boolean },
  intents: readonly ReadableIntent[] | undefined,
  stages: readonly CauseStage[],
) {
  if (deployment.recoveryRequired) return deployment.message;
  const reading = recoveryReading(intents);
  if (reading === null) return deployment.message;
  return readbackOutcome(reading) === "succeeded"
    ? (stageCause(stages) ?? NO_CAUSE)
    : `Recovery intent ${String(reading.sequence)}${settledWords(reading)}`;
}
