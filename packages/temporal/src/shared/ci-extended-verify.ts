/**
 * Pipeline message prefix for the nightly extended test tier run on main.
 * Deliberately not `ci-maintenance/`: maintenance admission treats a main
 * pipeline carrying that prefix as busy, and the nightly is not maintenance.
 */
export const CI_EXTENDED_VERIFY_PREFIX = "ci-extended-verify/";
/** The one workflow the config extension emits for an accepted request. */
export const CI_EXTENDED_VERIFY_WORKFLOW = "verify-extended";
/** Emitted instead when the requested source is no longer the verified main. */
export const CI_EXTENDED_SUPERSEDED_WORKFLOW = "extended-superseded";

export const ACTIVE_PIPELINE_STATUSES: ReadonlySet<string> = new Set([
  "created",
  "pending",
  "running",
  "blocked",
]);

export type ExtendedVerifyRequest = {
  requestId: string;
  /** The newest verified main commit the run was selected for. */
  source: string;
};

export type ExtendedVerifyReceipt = {
  number: number;
  url: string;
  /** The commit Woodpecker recorded: the branch tip at submission. */
  commit: string;
  status: string;
  workflows: { name: string; state: string }[];
};

export type ExtendedVerifySubmission =
  | { kind: "submitted"; receipt: ExtendedVerifyReceipt }
  | { kind: "deferred"; reason: string }
  | { kind: "skipped"; reason: "disabled" };

export type CiExtendedVerifySkipReason =
  "disabled" | "no-verified-source" | "deferred" | "superseded";

export type CiExtendedVerifyResult =
  | {
      outcome: "verified";
      pipeline: number;
      url: string;
      commit: string;
      durationMs: number;
    }
  | { outcome: "skipped"; reason: CiExtendedVerifySkipReason; detail: string };

/** The durable `ciExtendedVerify` memo a describe call exposes. */
export type CiExtendedVerifyMemo = {
  requestId: string;
  source: string | null;
  pipeline: number | null;
  url: string | null;
  status: string | null;
  observation: string;
};

export function extendedVerifyMessage(requestId: string): string {
  return `${CI_EXTENDED_VERIFY_PREFIX}${requestId}`;
}

export function isTerminalPipelineStatus(status: string): boolean {
  return !ACTIVE_PIPELINE_STATUSES.has(status);
}

/**
 * The extension emits a superseded no-work step in place of the verification
 * workflow when main's verified head moved between selection and dispatch.
 */
export function supersededReceipt(receipt: ExtendedVerifyReceipt): boolean {
  const names = new Set(receipt.workflows.map((workflow) => workflow.name));
  return (
    names.has(CI_EXTENDED_SUPERSEDED_WORKFLOW) &&
    !names.has(CI_EXTENDED_VERIFY_WORKFLOW)
  );
}

/** A green receipt ran the verification workflow; a skipped one is not green. */
export function extendedVerifySucceeded(receipt: ExtendedVerifyReceipt) {
  return (
    receipt.status === "success" &&
    receipt.workflows.some(
      (workflow) =>
        workflow.name === CI_EXTENDED_VERIFY_WORKFLOW &&
        workflow.state === "success",
    ) &&
    receipt.workflows.every((workflow) => workflow.state === "success")
  );
}

/** The failure text the Temporal failure watch forwards to Discord. */
export function extendedVerifyFailureMessage(
  receipt: ExtendedVerifyReceipt,
): string {
  const failed = receipt.workflows
    .filter((workflow) => workflow.state !== "success")
    .map((workflow) => `${workflow.name}=${workflow.state}`);
  const ran = receipt.workflows.some(
    (workflow) => workflow.name === CI_EXTENDED_VERIFY_WORKFLOW,
  );
  const detail = ran
    ? failed.length === 0
      ? "no workflow reported failure"
      : failed.join(", ")
    : `no ${CI_EXTENDED_VERIFY_WORKFLOW} workflow ran`;
  return `Extended verify pipeline ${receipt.number.toString()} ended ${receipt.status} at ${receipt.commit.slice(0, 12)} (${detail}): ${receipt.url}`;
}
