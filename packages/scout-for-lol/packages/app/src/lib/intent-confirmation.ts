import { z } from "zod";
import {
  CreationIntentKindSchema,
  DiscordGuildIdSchema,
  type CreationIntentKind,
  type DiscordGuildId,
} from "@scout-for-lol/data";

/**
 * How a confirmation's server answer is presented, for every intent family.
 *
 * React-free on purpose: a confirmation card renders one of a handful of
 * states, and which state it is depends entirely on a discriminated union the
 * server returned. Keeping that decision here means the interesting half is
 * unit-testable without a renderer, a query client, or a tRPC provider — and
 * that the dare and creation families cannot drift into two different readings
 * of "did this work".
 *
 * Both classifiers take `unknown` rather than the tRPC output type. The stored
 * replay of a *previous* confirmation arrives as opaque JSON from
 * `intentStatus` / `creationIntentStatus`, so the same value has to be read
 * from two places, only one of which is typed.
 */

export type DareIntentAction =
  "fund" | "accept" | "decline" | "contribute" | "cancel";

/** The presentation-facing verdict shared by every confirmation card. */
export type IntentConfirmationOutcome = {
  status: "confirmed" | "failed";
  message: string;
  retryable: boolean;
  deliveryWarning: string | null;
};

const KindResultSchema = z.looseObject({ kind: z.string() });
const NestedResultSchema = z.looseObject({ result: z.unknown() });
const CalloutResultSchema = z.looseObject({ callout: z.unknown() });

function kindOf(value: unknown): string | null {
  return KindResultSchema.safeParse(value).data?.kind ?? null;
}

function expectedKind(action: DareIntentAction): string {
  switch (action) {
    case "fund":
      return "funded";
    case "accept":
      return "accepted";
    case "decline":
      return "declined";
    case "contribute":
      return "contributed";
    case "cancel":
      return "cancelled";
  }
}

function nestedResult(value: unknown): unknown {
  return NestedResultSchema.safeParse(value).data?.result ?? null;
}

function deliveryWarning(value: unknown): string | null {
  return CalloutResultSchema.safeParse(value).data?.callout === "failed"
    ? "The action committed, but Scout could not post or refresh the public Dare callout. Nothing was reversed; delivery will be retried."
    : null;
}

export function classifyDareIntentConfirmation(
  action: DareIntentAction,
  result: unknown,
): IntentConfirmationOutcome {
  const kind = kindOf(result);
  const expected = expectedKind(action);
  if (kind === expected) {
    return {
      status: "confirmed",
      message: kind.replaceAll("_", " "),
      retryable: false,
      deliveryWarning: deliveryWarning(result),
    };
  }
  if (
    kind === "already_consumed" &&
    kindOf(nestedResult(result)) === expected
  ) {
    return {
      status: "confirmed",
      message: `${expected.replaceAll("_", " ")} earlier`,
      retryable: false,
      deliveryWarning: deliveryWarning(result),
    };
  }
  const failureKind = kind ?? "invalid result";
  return {
    status: "failed",
    message: failureKind.replaceAll("_", " "),
    retryable: kind === "insufficient" || kind === "feature_disabled",
    deliveryWarning: null,
  };
}

/** The entity a confirmed creation produced, and where it now lives. */
export type CreatedEntity = {
  entity: CreationIntentKind;
  entityId: number;
  guildId: DiscordGuildId;
};

/**
 * Why a creation was refused, as a bounded value.
 *
 * Analytics reports this and never the server's message: the registry forbids
 * sending error text, and a closed set is what makes the property groupable.
 */
export type CreationFailureReason =
  | "limit_reached"
  | "invalid_query"
  | "invalid_configuration"
  | "rate_limited"
  | "missing_permission"
  | "account_already_subscribed"
  | "subscription_already_exists"
  | "riot_id_not_found"
  | "intent_expired"
  | "already_used"
  | "unrecognized";

export type CreationConfirmationOutcome =
  | { status: "confirmed"; message: string; created: CreatedEntity }
  | { status: "failed"; message: string; reason: CreationFailureReason };

const CreatedResultSchema = z.looseObject({
  kind: z.literal("created"),
  entity: CreationIntentKindSchema,
  entityId: z.number().int().positive(),
  guildId: DiscordGuildIdSchema,
});

/**
 * Every refusal `confirmCreationIntent` can answer with, plus the claim
 * helper's own `intent_expired`. `message` is optional because the claim
 * refusals carry none.
 */
const RefusedResultSchema = z.looseObject({
  kind: z.enum([
    "limit_reached",
    "invalid_query",
    "invalid_configuration",
    "rate_limited",
    "missing_permission",
    "account_already_subscribed",
    "subscription_already_exists",
    "riot_id_not_found",
    "intent_expired",
  ]),
  message: z.string().min(1).optional(),
});

const ReplayedResultSchema = z.looseObject({
  kind: z.literal("already_consumed"),
  result: z.unknown(),
});

const CREATION_NOUN: Record<CreationIntentKind, string> = {
  report: "Report",
  subscription: "Subscription",
  competition: "Competition",
};

const DEFAULT_FAILURE_MESSAGE: Record<CreationFailureReason, string> = {
  limit_reached: "That server is at its limit.",
  invalid_query: "That query is not valid ScoutQL.",
  invalid_configuration: "That configuration is not valid.",
  rate_limited: "Too many of these were created recently. Try again later.",
  missing_permission: "You are missing a permission this needs.",
  account_already_subscribed: "That account is already tracked.",
  subscription_already_exists: "That player is already tracked there.",
  riot_id_not_found: "Riot no longer recognises that Riot ID.",
  intent_expired: "This confirmation expired before it was used.",
  already_used: "This confirmation has already been used.",
  unrecognized: "Scout could not confirm that.",
};

function refusal(
  reason: CreationFailureReason,
  message?: string,
): CreationConfirmationOutcome {
  return {
    status: "failed",
    reason,
    message: message ?? DEFAULT_FAILURE_MESSAGE[reason],
  };
}

/**
 * One answer, read without unwrapping a replay. Split out so the replay branch
 * cannot recurse: a stored result is itself a direct outcome, never another
 * `already_consumed`.
 */
function classifyDirectCreationResult(
  result: unknown,
): CreationConfirmationOutcome {
  const created = CreatedResultSchema.safeParse(result);
  if (created.success) {
    return {
      status: "confirmed",
      message: `${CREATION_NOUN[created.data.entity]} created.`,
      created: {
        entity: created.data.entity,
        entityId: created.data.entityId,
        guildId: created.data.guildId,
      },
    };
  }
  const refused = RefusedResultSchema.safeParse(result);
  if (refused.success) {
    return refusal(refused.data.kind, refused.data.message);
  }
  return refusal("unrecognized");
}

/**
 * How a creation confirmation went.
 *
 * `kind` is the kind the card was minted for; it is only used to describe a
 * replayed answer whose stored result could not be read, because the answer
 * itself always names the entity it created.
 */
export function classifyCreationIntentConfirmation(
  kind: CreationIntentKind,
  result: unknown,
): CreationConfirmationOutcome {
  const replayed = ReplayedResultSchema.safeParse(result);
  if (!replayed.success) {
    return classifyDirectCreationResult(result);
  }
  const stored = classifyDirectCreationResult(replayed.data.result);
  if (stored.status === "failed" && stored.reason === "unrecognized") {
    // Consumed, but the stored answer is not one this client understands.
    // Saying "already used" is the honest reading: the intent is spent either
    // way, and claiming a failure would invite a retry that cannot succeed.
    return refusal(
      "already_used",
      `${CREATION_NOUN[kind]} confirmation has already been used.`,
    );
  }
  return stored.status === "confirmed"
    ? {
        ...stored,
        message: `${CREATION_NOUN[stored.created.entity]} was already created.`,
      }
    : stored;
}
