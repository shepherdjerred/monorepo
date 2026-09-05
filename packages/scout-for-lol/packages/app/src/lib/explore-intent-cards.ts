import { z } from "zod";
import {
  CreationIntentKindSchema,
  DiscordGuildIdSchema,
  type CreationIntentKind,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import type { ScoutAnalyticsEvent } from "#src/lib/analytics-events.ts";
import type { CreatedEntity } from "#src/lib/intent-confirmation.ts";

/**
 * Reading confirmation cards out of a turn's persisted trace.
 *
 * The agent never writes domain state; it emits a tool result describing
 * something a human may then confirm. Both families — the Bryan Bucks dares
 * and the three Explore creations — put that proposal in the same place, so
 * one parse produces one ordered list of cards and the renderer only chooses
 * a body per kind.
 *
 * Deliberately React-free: parsing untrusted persisted JSON and deciding which
 * of five states a card is in are the two things worth testing, and neither
 * needs a renderer.
 */

const DareDraftDataSchema = z.strictObject({
  dareId: z.number().int().positive(),
  revision: z.number().int().positive(),
  canonicalScoutQl: z.string().min(1),
  plainLanguage: z.string().min(1),
  semanticProofPlan: z.string().min(1),
  openingStake: z.number().int().positive(),
  targetAliases: z.array(z.string()),
  originalText: z.string().min(1).optional(),
  sqlIsBinding: z.boolean().optional(),
});
export type DareDraftCardData = z.infer<typeof DareDraftDataSchema>;

const DareIntentDataSchema = z.strictObject({
  intentId: z.uuid(),
  action: z.enum(["fund", "accept", "decline", "contribute", "cancel"]),
  expiresAt: z.iso.datetime(),
  dareId: z.number().int().positive(),
  revision: z.number().int().positive(),
  originalText: z.string().min(1).optional(),
  plainLanguage: z.string().min(1).optional(),
  semanticProofPlan: z.string().min(1).optional(),
  canonicalScoutQl: z.string().min(1).optional(),
  sqlIsBinding: z.boolean().optional(),
});
export type DareIntentCardData = z.infer<typeof DareIntentDataSchema>;

const DareToolOutputSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.json().nullable(),
});

/**
 * A prepare tool's proposal. Strict, and `intent` is non-nullable here on
 * purpose: every refusal kind carries `intent: null`, so a refusal simply
 * fails to parse and produces no card rather than an empty one.
 */
const CreationToolOutputSchema = z.strictObject({
  kind: z.literal("creation_confirmation_required"),
  message: z.string(),
  intent: z.strictObject({
    intentId: z.uuid(),
    kind: CreationIntentKindSchema,
    guildId: DiscordGuildIdSchema,
    expiresAt: z.iso.datetime(),
    summary: z.string().min(1),
  }),
});
export type CreationIntentCardData = z.infer<
  typeof CreationToolOutputSchema
>["intent"];

export type IntentCard =
  | { kind: "dare_draft"; data: DareDraftCardData }
  | { kind: "dare_intent"; data: DareIntentCardData }
  | { kind: "creation_intent"; data: CreationIntentCardData };

function dareCard(
  output: z.infer<typeof DareToolOutputSchema>,
): IntentCard | null {
  if (output.kind === "created" || output.kind === "revised") {
    const draft = DareDraftDataSchema.safeParse(output.data);
    return draft.success ? { kind: "dare_draft", data: draft.data } : null;
  }
  if (output.kind === "confirmation_required") {
    const intent = DareIntentDataSchema.safeParse(output.data);
    return intent.success ? { kind: "dare_intent", data: intent.data } : null;
  }
  return null;
}

function cardFromToolOutput(value: unknown): IntentCard | null {
  const dare = DareToolOutputSchema.safeParse(value);
  if (dare.success) return dareCard(dare.data);
  const creation = CreationToolOutputSchema.safeParse(value);
  return creation.success
    ? { kind: "creation_intent", data: creation.data.intent }
    : null;
}

export function intentCardsFromTrace(trace: ExploreTraceEntry[]): IntentCard[] {
  const cards: IntentCard[] = [];
  for (const entry of trace) {
    if (entry.rawOutput?.kind !== "value") continue;
    const card = cardFromToolOutput(entry.rawOutput.value);
    if (card !== null) cards.push(card);
  }
  return cards;
}

/** Stable identity for a card in the rendered list. */
export function intentCardKey(card: IntentCard): string {
  return card.kind === "dare_draft"
    ? `dare-draft-${card.data.dareId.toString()}-${card.data.revision.toString()}`
    : card.data.intentId;
}

/** The five states one confirmation card can be read in. */
export type ConfirmationCardState =
  "pending" | "confirming" | "confirmed" | "expired" | "failed";

/**
 * Which state a card is in, given what the server has said so far.
 *
 * An answer always wins over the clock: an intent confirmed at 09:59 must not
 * read as expired at 10:00 simply because the card is still on screen.
 */
export function confirmationCardState(input: {
  outcome: { status: "confirmed" | "failed" } | null;
  confirming: boolean;
  expired: boolean;
}): ConfirmationCardState {
  if (input.outcome !== null) {
    return input.outcome.status === "confirmed" ? "confirmed" : "failed";
  }
  if (input.confirming) return "confirming";
  return input.expired ? "expired" : "pending";
}

/** Where a confirmed creation now lives in the dashboard. */
export function createdEntityLink(created: CreatedEntity): {
  href: string;
  label: string;
} {
  const guildPath = `/g/${created.guildId}`;
  switch (created.entity) {
    case "report":
      return {
        href: `${guildPath}/reports/${created.entityId.toString()}`,
        label: "Open the report",
      };
    case "competition":
      return {
        href: `${guildPath}/competitions/${created.entityId.toString()}`,
        label: "Open the competition",
      };
    case "subscription":
      // Subscriptions have no per-row page; the list is where one is managed.
      return {
        href: `${guildPath}/subscriptions`,
        label: "Open subscriptions",
      };
  }
}

const CREATION_CONFIRM_LABEL: Record<CreationIntentKind, string> = {
  report: "Create this report",
  subscription: "Track this player",
  competition: "Start this competition",
};

const CREATION_CREATED_HEADING: Record<CreationIntentKind, string> = {
  report: "Report created",
  subscription: "Player tracked",
  competition: "Competition created",
};

const CREATION_FAILED_HEADING: Record<CreationIntentKind, string> = {
  report: "Report was not created",
  subscription: "Player was not tracked",
  competition: "Competition was not created",
};

export function creationCardHeading(
  kind: CreationIntentKind,
  state: ConfirmationCardState,
): string {
  switch (state) {
    case "confirmed":
      return CREATION_CREATED_HEADING[kind];
    case "failed":
      return CREATION_FAILED_HEADING[kind];
    case "expired":
      return "This confirmation expired";
    case "pending":
    case "confirming":
      return CREATION_CONFIRM_LABEL[kind];
  }
}

const CREATION_CONFIRMED_EVENT: Record<
  CreationIntentKind,
  ScoutAnalyticsEvent
> = {
  report: "explore_report_created",
  subscription: "explore_subscription_created",
  competition: "explore_competition_created",
};

/**
 * The event a successful creation reports.
 *
 * Keyed off the entity the server says it created rather than the kind the
 * card was minted for, so the two can never disagree in the funnel.
 */
export function creationConfirmedEvent(
  entity: CreationIntentKind,
): ScoutAnalyticsEvent {
  return CREATION_CONFIRMED_EVENT[entity];
}
