import type {
  CommitEnvironmentState,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";

// Each verdict borrows the pipeline status it resembles and keeps its own
// words, so one `Status` draws the same glyph, green, red and amber everywhere
// in the hub.
export const VERDICT: Record<
  CommitVerdict,
  { status: string; label: string; sentence: string }
> = {
  deployed: {
    status: "succeeded",
    label: "Deployed",
    sentence: "Live in every environment that tracks it.",
  },
  deploying: {
    status: "running",
    label: "Deploying",
    sentence: "A deployment that carries it is queued or running.",
  },
  awaiting_approval: {
    status: "awaiting_approval",
    label: "Needs approval",
    sentence:
      "A deployment that carries it is waiting for someone to approve it.",
  },
  recovery_required: {
    status: "failed",
    label: "Recovery required",
    sentence:
      "A failed deployment locked an environment, so nothing reaches it until an operator recovers it.",
  },
  failed: {
    status: "failed",
    label: "Failed",
    sentence: "The newest deployment that carries it failed.",
  },
  build_failed: {
    status: "failed",
    label: "CI failed",
    sentence: "CI failed, so nothing from this commit was published.",
  },
  building: {
    status: "running",
    label: "CI running",
    sentence: "CI has not finished, so nothing is deployed yet.",
  },
  waiting: {
    status: "pending",
    label: "Not released",
    sentence: "Nothing that would deliver it is queued or running.",
  },
  nothing_to_deploy: {
    status: "not_started",
    label: "Nothing to deploy",
    sentence: "This commit changed nothing that Delivery deploys.",
  },
  unknown: {
    status: "unknown",
    label: "Not seen yet",
    sentence:
      "Delivery has not heard of this commit. CI may not have published it yet.",
  },
};

/** One environment's standing: its chip's glyph and words, and why, as a sentence. */
export const ENVIRONMENT: Record<
  CommitEnvironmentState,
  { status: string; label: string; reason: string }
> = {
  live: { status: "succeeded", label: "live", reason: "has it." },
  superseded: {
    status: "succeeded",
    label: "live (newer)",
    reason: "has it through a newer release.",
  },
  deploying: {
    status: "running",
    label: "deploying",
    reason: "has a deployment that carries it queued or running.",
  },
  awaiting_approval: {
    status: "awaiting_approval",
    label: "needs approval",
    reason: "has a deployment that carries it waiting for approval.",
  },
  recovery_required: {
    status: "failed",
    label: "recovery required",
    reason: "is locked by a failed deployment until an operator recovers it.",
  },
  failed: {
    status: "failed",
    label: "failed",
    reason: "failed the newest deployment that carries it.",
  },
  canceled: {
    status: "canceled",
    label: "canceled",
    reason:
      "had the deployment that carried it canceled, and nothing else is in flight.",
  },
  replaced: {
    status: "pending",
    label: "replaced",
    reason: "ran it, then another release replaced it.",
  },
  manual: {
    status: "pending",
    label: "needs manual release",
    reason: "needs a manual promotion or release; nothing is in flight.",
  },
  waiting: {
    status: "pending",
    label: "waiting for earlier stage",
    reason: "waits for the environment it promotes from to have it first.",
  },
  not_started: {
    status: "not_started",
    label: "not started",
    reason: "has not started a deployment of it.",
  },
};

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** What the list row says is stuck, named by service and environment. */
export function blockerNote(blocker: NonNullable<CommitSummary["blocker"]>) {
  return `${blocker.service} / ${blocker.environment}: ${ENVIRONMENT[blocker.state].label}`;
}

/** The list row's notes beside its tallies: failed CI first, then what is stuck. */
export function rowNotes(commit: CommitSummary): string[] {
  const notes: string[] = [];
  if (commit.failedBuildCount > 0)
    notes.push(
      `CI failed for ${plural(commit.failedBuildCount, "service", "services")}`,
    );
  if (commit.blocker !== null) notes.push(blockerNote(commit.blocker));
  return notes;
}

/**
 * The commit page's one statement: what the verdict means for this commit,
 * then how many changed services are live and, if not all, which
 * environment is stuck and why. A commit whose own CI failed for some
 * services can still have its other changes live, often through newer
 * commits; the statement says so instead of contradicting the rows.
 */
export function commitStatement(status: CommitStatus): string {
  const failed = status.failedBuilds.length;
  // A changed service no environment tracks has nowhere to be live.
  const changed = status.changed.filter(
    (entry) => entry.environments.length > 0,
  );
  const opening =
    status.verdict === "build_failed" && changed.length > 0
      ? `CI failed for ${plural(failed, "service", "services")}, so Delivery published nothing for ${failed === 1 ? "it" : "them"}.`
      : VERDICT[status.verdict].sentence;
  return changed.length === 0
    ? opening
    : [opening, ...liveness(changed, status.blocker)].join(" ");
}

/** How many changed services are live, and if not all, where it is stuck and why. */
function liveness(
  changed: CommitStatus["changed"],
  blocker: CommitStatus["blocker"],
): string[] {
  const live = changed.filter((entry) => entry.verdict === "deployed");
  if (live.length < changed.length)
    return [
      `${String(live.length)} of ${plural(changed.length, "changed service is", "changed services are")} live.`,
      ...(blocker === null
        ? []
        : [
            `${blocker.service} ${blocker.environment} ${ENVIRONMENT[blocker.state].reason}`,
          ]),
    ];
  const subject =
    changed.length === 1
      ? "Its 1 changed service is"
      : `All ${String(changed.length)} changed services are`;
  const throughNewer = changed.every((entry) =>
    entry.environments.every(
      (environment) => environment.state === "superseded",
    ),
  );
  return [
    throughNewer
      ? `${subject} live because newer commits include ${changed.length === 1 ? "it" : "them"}.`
      : `${subject} live.`,
  ];
}

/** The line under the changed services: how many built with nothing to deploy. */
export function unchangedLine(count: number) {
  return `${plural(count, "other service", "other services")} built with nothing to deploy.`;
}

const SHA = /^[0-9a-f]{7,40}$/iu;

/** A pasted commit SHA, trimmed; null when it is not 7 to 40 hex digits. */
export function parseSha(input: string): string | null {
  const sha = input.trim();
  return SHA.test(sha) ? sha.toLowerCase() : null;
}
