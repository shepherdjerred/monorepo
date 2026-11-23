import type {
  CommitEnvironmentState,
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
    sentence: "A deployment that carries it is running.",
  },
  queued: {
    status: "queued",
    label: "Queued",
    sentence: "A deployment that carries it is queued, waiting to start.",
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
  // With an environment to name, `verdictView` names what it waits on instead.
  waiting: {
    status: "pending",
    label: "Not released",
    sentence: "No release of a service it changed includes it yet.",
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
    reason: "has a deployment that carries it running.",
  },
  queued: {
    status: "queued",
    label: "queued",
    reason: "has a deployment that carries it queued, waiting to start.",
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
    reason: "ran it, then a release that does not include it replaced it.",
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
