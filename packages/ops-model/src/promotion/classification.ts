import type {
  PromotionHistoryEntry,
  PromotionOverview,
  PromotionRunRow,
} from "./model.ts";

type Source = PromotionOverview["sources"][number];
export type RunState = Pick<PromotionRunRow, "health" | "outcome" | "reason">;
type Context = {
  source: Source;
  status: string;
  phase: string;
  detail: string;
  interrupted: boolean;
  knownGood: boolean;
  history: PromotionHistoryEntry[];
};

function pendingReason(notes: string) {
  const rules: [RegExp, string][] = [
    [/ownership/i, "Listing ownership is not assigned"],
    [/removed|restoration/i, "Listing needs restoration"],
    [/level roles|earned level/i, "Required Discord roles are missing"],
    [/server.age|three.month/i, "Onboarding requirements are not met"],
    [/onboarding|no listing submitted/i, "Listing setup is incomplete"],
  ];
  return (
    rules.find(([pattern]) => pattern.test(notes))?.[1] ??
    "No bump or approved content update is set up"
  );
}

function setupReason({ source, history }: Context) {
  if (source.action === "pending") return pendingReason(source.notes);
  if (source.action === "inspect")
    return "Inspection only; no publishing action is set up";
  if (source.constraint.startsWith("Automatically paused after"))
    return source.constraint;
  if (source.constraint !== "Paused") return null;
  return history.some(
    (item) => item.targetId === source.id && item.status === "filtered",
  )
    ? "Paused after the site filtered a post"
    : "Paused by the operator";
}

function accessState({ detail }: Context): RunState | null {
  // Only observed missing prerequisites; this never probes credentials.
  const email =
    /email.code lookup failed|email confirmation|verification email.*(?:unavailable|not synced)|MailMate/i.test(
      detail,
    );
  const login =
    /credentials? (?:are |is )?(?:missing|unavailable)|login is absent|stored login.*rejected|password.*rejected|service.account.*(?:denied|unavailable)/i.test(
      detail,
    );
  if (!email && !login) return null;
  return {
    health: "error",
    outcome: "error",
    reason: email
      ? "Email verification failed; retry is available"
      : "Login failed; retry is available",
  };
}

function failureReason(detail: string) {
  if (/cloudflare/i.test(detail)) return "Cloudflare blocked access";
  if (/timed? out|timeout/i.test(detail)) return "The request timed out";
  return /unconfirmed|uncertain|ambiguous/i.test(detail)
    ? "Could not confirm the action; duplicate prevention is active"
    : "The source did not complete successfully";
}

function executionState(context: Context): RunState {
  const { status, phase, detail } = context;
  if (status === "skipped" && phase === "budget")
    return {
      health: "error",
      outcome: "error",
      reason: "Skipped at the daily spending stop",
    };
  if (status === "skipped" && phase === "window")
    return {
      health: "working",
      outcome: "not_due",
      reason: "Skipped outside the preferred publishing window",
    };
  if (status === "skipped" && phase === "disabled")
    return {
      health: "disabled",
      outcome: "disabled",
      reason: "Publishing is not enabled for this source",
    };
  if (context.interrupted)
    return {
      health: "error",
      outcome: "error",
      reason: "Run was interrupted before confirmation",
    };
  if (isCooldown(context))
    return {
      health: "working",
      outcome: "not_due",
      reason: "Skipped because of a cooldown",
    };
  if (status === "running" || status === "queued")
    return {
      health: "checking",
      outcome: status,
      reason: status === "running" ? "Running now" : "Waiting for its turn",
    };
  return phase === "blocked" || phase === "owner"
    ? { health: "error", outcome: "error", reason: failureReason(detail) }
    : terminalState(context);
}

function isCooldown({ phase, status, detail }: Context) {
  if (phase === "cooldown") return true;
  const nativeDisabled =
    /native control is disabled.*cooldown|bump server on cooldown/i.test(
      detail,
    );
  const skip = status === "skipped" && /\bcooldown\b/i.test(detail);
  return (
    (nativeDisabled || skip) &&
    !/unconfirmed|ambiguous|uncertain|no matching|timed? out|timeout|failed/i.test(
      detail,
    )
  );
}

function terminalState({
  status,
  phase,
  detail,
  knownGood,
}: Context): RunState {
  if (
    [
      "blocked",
      "failed",
      "uncertain",
      "rejected",
      "filtered",
      "interrupted",
    ].includes(status)
  )
    return { health: "error", outcome: "error", reason: failureReason(detail) };
  if (
    status === "verified" ||
    phase === "verified" ||
    phase === "copy-corrected"
  )
    return {
      health: "working",
      outcome: "done",
      reason: "Completed and confirmed",
    };
  if (status === "preview" || phase === "preview")
    return {
      health: "checking",
      outcome: "not_run",
      reason: "Inspection only; nothing was published",
    };
  if (status === "completed")
    return { health: "error", outcome: "error", reason: failureReason(detail) };
  return {
    health: knownGood ? "working" : "disabled",
    outcome: "not_run",
    reason: knownGood
      ? "Not selected in this run"
      : "Automation has not been verified yet",
  };
}

export function classifyRunSource(context: Context): RunState {
  if (context.source.constraint === "Needs reconciliation")
    return {
      health: "error",
      outcome: "error",
      reason:
        "Could not confirm the previous action; duplicate prevention is active",
    };
  const setup = setupReason(context);
  return setup === null
    ? (accessState(context) ?? executionState(context))
    : {
        health: "disabled",
        outcome:
          setup.startsWith("Automatically paused after") &&
          !["skipped", "not_run", "queued", "running"].includes(context.status)
            ? "error"
            : "disabled",
        reason: setup,
      };
}
