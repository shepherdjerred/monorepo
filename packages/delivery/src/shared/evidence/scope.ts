/**
 * The grammar of an evidence id, shared by the server code that writes and
 * reads those ids and by the browser that groups evidence under what
 * recorded it. An id is `<deployment>/<prefix>/<entry>`: the prefix opens
 * with the writer's name, and the entry is an offset or a fingerprint,
 * neither of which contains a `/`. Browser-safe: no Node and no database
 * imports.
 */

const STAGE_WRITER = "stage";
const MONITOR_WRITER = "monitor";
const MONITOR_ALARMS = "alarms";
/** Each recovery writer's name, and the kind of intent it settles. */
const RECOVERY_WRITERS = new Map<string, "argo" | "worker" | "content">([
  ["recovery", "argo"],
  ["worker-recovery", "worker"],
  ["content-recovery", "content"],
]);

/** Evidence the executor reports with the deployment's result. */
export const FINISH_EVIDENCE_PREFIX = "finish";
/** The alarms a monitor observation counted. */
export const MONITOR_ALARM_EVIDENCE_PREFIX = `${MONITOR_WRITER}/${MONITOR_ALARMS}`;
/** Drift observed on the accepted deployment. */
export const DRIFT_EVIDENCE_PREFIX = "drift";

/** Evidence one stage recorded; a sub-stage keyed `<key>/<name>` is its own stage. */
export function stageEvidencePrefix(key: string) {
  return `${STAGE_WRITER}/${key}`;
}
/** The evidence a monitor observation settled on. */
export function monitorEvidencePrefix(sequence: number) {
  return `${MONITOR_WRITER}/${String(sequence)}`;
}
/** What settled an Argo lock-recovery intent. */
export function recoveryEvidencePrefix(intentId: string) {
  return `recovery/${intentId}`;
}
/** What settled a worker-pool recovery intent. */
export function workerRecoveryEvidencePrefix(intentId: string) {
  return `worker-recovery/${intentId}`;
}
/** What settled a content recovery intent. */
export function contentRecoveryEvidencePrefix(intentId: string) {
  return `content-recovery/${intentId}`;
}

/** The id prefix every entry of one writer shares: `<deployment>/<prefix>/`. */
export function evidenceScopeId(deploymentId: string, prefix: string) {
  return `${deploymentId}/${prefix}/`;
}
/** The id prefix of one stage's evidence, which its sub-stages' ids also start with. */
export function stageEvidenceScopeId(deploymentId: string, key: string) {
  return evidenceScopeId(deploymentId, stageEvidencePrefix(key));
}

/**
 * Whether an evidence id was recorded by exactly this stage, as `evidence`
 * names it: `<deployment>/stage/<key>/<entry>`. A sub-stage keyed
 * `<key>/<name>` is a different stage.
 */
export function recordedByStage(
  evidenceId: string,
  deploymentId: string,
  key: string,
): boolean {
  const scope = stageEvidenceScopeId(deploymentId, key);
  return (
    evidenceId.startsWith(scope) &&
    !evidenceId.slice(scope.length).includes("/")
  );
}

/** What recorded one piece of evidence, read from its id. */
export type EvidenceScope =
  | { kind: "stage"; key: string; entry: string }
  | { kind: "finish"; entry: string }
  | { kind: "monitor"; part: "alarms" | "observation"; entry: string }
  | { kind: "drift"; entry: string }
  | {
      kind: "recovery";
      recovery: "argo" | "worker" | "content";
      intentId: string;
      entry: string;
    }
  /** An id of another shape: an older row, or a writer outside this grammar. */
  | { kind: "other" };

const OTHER: EvidenceScope = { kind: "other" };

/**
 * The scope of a prefix that has something between its writer and its entry:
 * a stage key, a monitor sequence or an intent id.
 */
function subjectScope(
  writer: string,
  subject: string,
  entry: string,
): EvidenceScope {
  if (writer === STAGE_WRITER) return { kind: "stage", key: subject, entry };
  if (writer === MONITOR_WRITER) {
    if (subject === MONITOR_ALARMS)
      return { kind: "monitor", part: "alarms", entry };
    return /^\d+$/u.test(subject)
      ? { kind: "monitor", part: "observation", entry }
      : OTHER;
  }
  const recovery = RECOVERY_WRITERS.get(writer);
  return recovery === undefined
    ? OTHER
    : { kind: "recovery", recovery, intentId: subject, entry };
}

/**
 * Read an evidence id's scope. The entry never contains a `/`, so a stage's
 * key is everything before the last one: the longest key the id can name,
 * which keeps a sub-stage's evidence out of its parent stage exactly as
 * `recordedByStage` does. An id that does not fit is still valid evidence
 * and reads as `other`.
 */
export function evidenceScope(
  evidenceId: string,
  deploymentId: string,
): EvidenceScope {
  const own = `${deploymentId}/`;
  if (!evidenceId.startsWith(own)) return OTHER;
  const rest = evidenceId.slice(own.length);
  const first = rest.indexOf("/");
  const last = rest.lastIndexOf("/");
  if (first === -1) return OTHER;
  const writer = rest.slice(0, first);
  const entry = rest.slice(last + 1);
  if (first !== last)
    return subjectScope(writer, rest.slice(first + 1, last), entry);
  switch (writer) {
    case FINISH_EVIDENCE_PREFIX: {
      return { kind: "finish", entry };
    }
    case DRIFT_EVIDENCE_PREFIX: {
      return { kind: "drift", entry };
    }
    default: {
      return OTHER;
    }
  }
}
