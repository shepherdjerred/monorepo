import { z } from "zod";
import { BucksStakeSchema } from "./bryan-bucks.ts";
import { CompetitionWriteSchema } from "./competition-write.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "./discord.ts";
import { PlayerAliasSchema } from "./form-inputs.ts";
import {
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdPartsSchema,
} from "./league-account.ts";
import { ReportCreateInputSchema } from "./report.ts";
import { SubscriptionFilterSpecSchema } from "./subscription-filter.ts";

/**
 * The arms that act on an existing dare.
 *
 * Split out of the full union rather than filtered back out of it, because
 * `dare.prepareAction` takes a payload straight off the wire: a union that
 * admitted a creation arm would let a client mint a creation intent through
 * the dare prepare procedure, bypassing the creation gate entirely.
 */
const dareIntentPayloadArms = [
  z.strictObject({ kind: z.literal("dare_fund") }),
  z.strictObject({ kind: z.literal("dare_accept") }),
  z.strictObject({ kind: z.literal("dare_decline") }),
  z.strictObject({
    kind: z.literal("dare_contribute"),
    amount: BucksStakeSchema,
  }),
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
]);
export type ConfirmationIntentPayload = z.infer<
  typeof ConfirmationIntentPayloadSchema
>;

/** The kinds that act on an existing dare. */
export const DareIntentKindSchema = z.enum([
  "dare_fund",
  "dare_accept",
  "dare_decline",
  "dare_contribute",
  "dare_cancel",
]);
export type DareIntentKind = z.infer<typeof DareIntentKindSchema>;

/**
 * The kinds that create a domain entity rather than acting on an existing
 * dare. They are gated, authorized and executed by their own procedure, so the
 * split is a real boundary and not merely a naming convention.
 */
export const CreationIntentKindSchema = z.enum([
  "report",
  "subscription",
  "competition",
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
]);
export type ConfirmationIntentKind = z.infer<
  typeof ConfirmationIntentKindSchema
>;
