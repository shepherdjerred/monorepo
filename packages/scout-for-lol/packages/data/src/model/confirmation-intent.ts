import { z } from "zod";
import { CompetitionWriteSchema } from "#src/model/competitions/competition-write.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/core/discord.ts";
import { PlayerAliasSchema } from "#src/model/core/form-inputs.ts";
import {
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdPartsSchema,
} from "#src/model/riot/league-account.ts";
import {
  ReportCreateInputSchema,
  ReportIdSchema,
  ReportUpdateInputSchema,
} from "#src/model/reports/report.ts";
import { SubscriptionFilterSpecSchema } from "#src/model/core/subscription-filter.ts";
import {
  operationsIntentPayloadArms,
  OperationsIntentKindSchema,
} from "#src/model/operations/operations-intent.ts";

/**
 * The arms that act on an existing dare.
 *
 * Split out of the full union rather than filtered back out of it, because
 * `dare.prepareAction` takes a payload straight off the wire: a union that
 * admitted a creation arm would let a client mint a creation intent through
 * the dare prepare procedure, bypassing the creation gate entirely.
 */
const dareIntentPayloadArms = [
  z.strictObject({ kind: z.literal("dare_publish") }),
  z.strictObject({ kind: z.literal("dare_accept") }),
  z.strictObject({ kind: z.literal("dare_decline") }),
  z.strictObject({ kind: z.literal("dare_cancel") }),
] as const;

/**
 * The arms that create a domain entity an Explore agent prepared.
 *
 * They reuse the same schemas the web forms post (`ReportCreateInputSchema`,
 * `CompetitionWriteSchema`) rather than restating field shapes, so a prepared
 * entity and a hand-filled form cannot describe different things. Nothing in
 * the payload is trusted as authorization: the confirm path re-resolves the
 * caller's permissions from scratch and reads the guild off the intent row,
 * not out of here.
 */
const creationIntentPayloadArms = [
  z.strictObject({
    kind: z.literal("report"),
    guildId: DiscordGuildIdSchema,
    ...ReportCreateInputSchema.shape,
  }),
  z.strictObject({
    kind: z.literal("subscription"),
    guildId: DiscordGuildIdSchema,
    channelId: DiscordChannelIdSchema,
    region: RegionSchema,
    alias: PlayerAliasSchema,
    discordUserId: DiscordAccountIdSchema.optional(),
    /**
     * Whether the account joins an existing player under this alias (true) or
     * starts a new one (false). Re-checked at confirm, so the alias changing
     * hands in between cannot merge two people. Absent on older intents.
     */
    joinExistingPlayer: z.boolean().optional(),
    filters: SubscriptionFilterSpecSchema.nullable().optional(),
    /**
     * The PUUID and Riot-canonical Riot ID are frozen when the intent is
     * prepared, never re-resolved at confirm time. Riot's account lookup
     * routinely takes seconds and confirm runs inside a Prisma transaction
     * whose 5s timeout would trip `P2028` — the same reason
     * `subscription.add` resolves them before opening its transaction.
     */
    puuid: LeaguePuuidSchema,
    riotId: RiotIdPartsSchema,
  }),
  z.strictObject({
    kind: z.literal("competition"),
    guildId: DiscordGuildIdSchema,
    ...CompetitionWriteSchema.shape,
  }),
  /**
   * An edit to an existing report, prepared by Explore. `reportId` names the
   * row in `guildId`; the remaining fields are the partial
   * `ReportCreateInput`-shaped edit (see `ReportUpdateInputSchema`), so a
   * display-column change is simply a `queryText` rewrite. Nothing here is
   * trusted as authorization: confirm re-checks `reports:update`, that the
   * report still exists in the guild, and that it is not system-managed.
   */
  z.strictObject({
    kind: z.literal("report_update"),
    guildId: DiscordGuildIdSchema,
    reportId: ReportIdSchema,
    ...ReportUpdateInputSchema.shape,
  }),
] as const;

export const DareIntentPayloadSchema = z.discriminatedUnion(
  "kind",
  dareIntentPayloadArms,
);
export type DareIntentPayload = z.infer<typeof DareIntentPayloadSchema>;

/**
 * The payload of a confirmation intent: an actor-bound, single-use, expiring
 * row that a human confirms, at which point the real action executes.
 *
 * `kind` is the only discriminator. It used to be stored twice — a column
 * beside the payload and a field inside it — which made a disagreement
 * representable and forced a runtime assertion at confirm time. One field
 * makes that state unrepresentable instead.
 */
export const ConfirmationIntentPayloadSchema = z.discriminatedUnion("kind", [
  ...dareIntentPayloadArms,
  ...creationIntentPayloadArms,
  ...operationsIntentPayloadArms,
]);
export type ConfirmationIntentPayload = z.infer<
  typeof ConfirmationIntentPayloadSchema
>;

/** The kinds that act on an existing dare. */
export const DareIntentKindSchema = z.enum([
  "dare_publish",
  "dare_accept",
  "dare_decline",
  "dare_cancel",
]);
export type DareIntentKind = z.infer<typeof DareIntentKindSchema>;

/**
 * The kinds an Explore agent may prepare for confirmation rather than acting
 * on an existing dare. `report_update` edits an existing report instead of
 * creating one, but it is gated, authorized and executed by the same
 * procedure as the creations, so it lives with them; the split from the dare
 * kinds is a real boundary and not merely a naming convention.
 */
export const CreationIntentKindSchema = z.enum([
  "report",
  "subscription",
  "competition",
  "report_update",
]);
export type CreationIntentKind = z.infer<typeof CreationIntentKindSchema>;

export type CreationIntentPayload = Extract<
  ConfirmationIntentPayload,
  { kind: CreationIntentKind }
>;

/** Every kind a stored confirmation intent may carry. */
export const ConfirmationIntentKindSchema = z.enum([
  ...DareIntentKindSchema.options,
  ...CreationIntentKindSchema.options,
  ...OperationsIntentKindSchema.options,
]);
