import type { z } from "zod";
import type { RecoveryListSchema } from "#shared/recovery.ts";

/** A badge's words and tone; recovery states are never in progress. */
type Copy = { label: string; tone: "ok" | "warn" | "danger" | "neutral" };

type Authority = NonNullable<z.infer<typeof RecoveryListSchema>["authority"]>;

/**
 * What the runtime may do on its own after a restore, in the owner's words.
 * `note` says what the owner can expect from it.
 */
export const AUTOMATION_MODE_COPY = {
  active: {
    label: "Automation is running",
    tone: "ok",
    note: "Media is acting on the library by itself.",
  },
  observe: {
    label: "Automation is only watching",
    tone: "warn",
    note: "Resuming automation needs a separately reviewed ownership handoff.",
  },
  uninitialized: {
    label: "Automation has not started",
    tone: "warn",
    note: "Media has not started acting on the library.",
  },
} as const satisfies Record<
  Authority["mode"],
  Copy & { readonly note: string }
>;

/** One kind of authority Media must hold before it may write: current or not. */
export const AUTHORITY_STATE_COPY = {
  current: { label: "Current", tone: "ok" },
  missing: { label: "Missing", tone: "warn" },
  revoked: { label: "Revoked", tone: "danger" },
  stale: { label: "Out of date", tone: "warn" },
} as const satisfies Record<Authority["writerState"], Copy>;

/**
 * Why a title is held after a restore. The contract types the reason as a
 * string, so a reason this table does not know is shown by its own name.
 */
const HOLD_REASON_COPY: Readonly<Record<string, string>> = {
  recovery_request_history_unconfirmed:
    "The restore lost who asked for it and who wanted to keep it.",
  legacy_claim_reconciliation_required:
    "Requests from the old system are not yet matched to household members.",
  migration_household_intent_review_required:
    "Imported from the old system; the household has not yet said what it wants.",
};

export function holdReasonSentence(reason: string): string {
  return HOLD_REASON_COPY[reason] ?? reason.replaceAll("_", " ");
}

/**
 * What stops a review from releasing anything, as one sentence. The contract
 * types a blocker as a string and new ones appear with the server, so one
 * this table does not know is shown by its own name.
 */
const BLOCKER_COPY: Readonly<Record<string, string>> = {
  no_active_recovery_hold: "None of these titles is held any more.",
  hold_epoch_changed: "The hold on a title changed after this review began.",
  household_identity_requires_reconciliation:
    "A household member's Plex identity no longer matches what the review recorded.",
  historical_claim_access_revoked:
    "Someone with an old request has lost access to the library.",
  unresolved_migration_household_claim:
    "Requests imported from the old system are still unmatched.",
  legacy_claim_requester_unmapped:
    "A requester in the imported history is not matched to a household member.",
  legacy_claim_capture_incomplete:
    "The imported history from the old system is incomplete.",
  legacy_claim_history_exceeds_bound:
    "The imported history is too long for one review.",
  legacy_claim_binding_identity_changed:
    "A matched requester's identity changed after the match was saved.",
  handoff_history_requires_bounded_reconciliation:
    "Files adopted from the previous system need their history reconciled first.",
  selected_intent_not_rebaselined:
    "A selected title still has request settings from before the restore.",
  selected_assets_not_rebaselined:
    "A selected file has not been proven again since the restore.",
  shared_coverage_incomplete:
    "Some episodes share a file with a title that is not in this review.",
  select_physical_episode_coverage:
    "A whole series cannot be reviewed at once; select one group of episodes.",
  root_request_projection_incomplete:
    "The series request has not yet been broken down into its episodes.",
  root_request_coordinates_unconfirmed:
    "The series request cannot be tied to exact episodes yet.",
  partial_root_request_scope:
    "The review covers only part of a series request.",
  movie_history_runtime_changed:
    "Media's runtime changed after this review was captured.",
  movie_history_acquisition_unsettled:
    "The film is still being downloaded or imported.",
  subtitle_replacement_unsettled:
    "A subtitle replacement for this film has not finished.",
};

export function blockerSentence(blocker: string): string {
  return BLOCKER_COPY[blocker] ?? blocker.replaceAll("_", " ");
}

/**
 * Where a household review stands. The contract types the state as a string;
 * only these two occur, and the badge says plainly which one waits on people.
 */
const REVIEW_STATE_COPY = {
  awaiting_responses: { label: "Waiting for declarations", tone: "warn" },
  released: { label: "Applied", tone: "ok" },
} as const satisfies Record<string, Copy>;

export function reviewStateCopy(state: string): Copy {
  const known = Object.entries(REVIEW_STATE_COPY).find(
    ([key]) => key === state,
  );
  if (known === undefined) {
    throw new Error(`Unknown recovery review state "${state}"`);
  }
  return known[1];
}

export function isWaitingState(state: string): boolean {
  return state === "awaiting_responses";
}

/** What a person can declare for a title, and what each choice does. */
export const DECLARATION_COPY = {
  request: {
    option: "Keep requesting",
    consequence: "It stays requested once the owner applies this review.",
  },
  keep: {
    option: "Keep for 30 days",
    consequence:
      "It is held for you for 30 days after the owner applies this review.",
  },
  no_longer_request: {
    option: "No longer requested",
    consequence: "Your request for it ends when the owner applies this review.",
  },
} as const satisfies Record<
  "request" | "keep" | "no_longer_request",
  { option: string; consequence: string }
>;
