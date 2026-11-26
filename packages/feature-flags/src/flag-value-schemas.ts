import { z } from "zod";
import type { ManagedVariantFlagKey } from "./managed-flag-keys.generated.ts";
import {
  CodeReviewSettingsSchema,
  ExploreQuotaLimitsSchema,
  ExploreSpendPolicySchema,
  MailSettingsSchema,
  PromotionSettingsSchema,
  RedditOutreachSettingsSchema,
} from "./flag-value-settings.ts";
import {
  commaListSchema,
  EmailSchema,
  jsonSchemaForSpec,
  MailboxSchema,
  ModelIdSchema,
  SnowflakeSchema,
  variantJson,
  variantNumber,
  variantString,
  type VariantEncoding,
  type VariantValueIssue,
  type VariantValueSpec,
  type VariantValueValidation,
} from "./flag-value-spec.ts";

const NonEmptyStringListSchema = z.array(z.string().min(1));
const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().nonnegative();
const PlexSectionIdSchema = z.string().regex(/^[1-9]\d*$/u);

/** `@shepherdjerred/storm-theme` catalog ids plus `auto` (`SeasonChoiceSchema`). */
const STORM_SEASONS = [
  "auto",
  "normal",
  "spring",
  "summer",
  "autumn",
  "winter",
  "newyear",
  "valentines",
  "easter",
  "midsummer",
  "harvest",
  "halloween",
  "thanksgiving",
  "christmas",
] as const;

/** Mirrors Scout's `SemanticVersionSchema`, with its `i` flag spelled out so JSON Schema keeps it. */
const SemanticVersionSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u,
  );

/**
 * Home Assistant `domain.object_id`, optionally `:Label`, comma-separated
 * (trmnl `parseEntities`). The empty string is an explicit empty selection
 * that hides the tile.
 */
const HomeAssistantEntitiesSchema = z.union([
  z.literal(""),
  commaListSchema(
    String.raw`[a-z0-9_]+\.[a-z0-9_]+(?::[^,:\s](?:[^,:]*[^,:\s])?)?`,
    "Expected comma-separated `domain.object_id[:Label]` entries, or empty to hide the tile",
  ),
]);

/**
 * Photon owner handles: the literal `[]` (none) or up to 20 comma-separated
 * handles of at most 200 characters (temporal `ImessageOwnersSchema`).
 */
const PhotonOwnersSchema = z
  .string()
  .regex(
    /^[^,\s](?:[^,]*[^,\s])?(?:,\s*[^,\s](?:[^,]*[^,\s])?)*$/u,
    "Expected `[]` or comma-separated handles",
  )
  .refine(
    (value) => value === "[]" || value.split(",").length <= 20,
    "At most 20 owner handles",
  )
  .refine(
    (value) =>
      value === "[]" ||
      value.split(",").every((entry) => entry.trim().length <= 200),
    "Each owner handle is at most 200 characters",
  );

/**
 * The decoded type of every managed variant flag, keyed by flag key. This is
 * the single source of truth: the Flags server rejects writes that fail it,
 * drift reports live values that fail it, consumers read through
 * `flagValueSchema(key)`, and `flag-value-schemas.generated.json` exports it
 * as JSON Schema for editors.
 *
 * Each entry mirrors the consumer schema that reads the key (see the package
 * README for the tightenings applied where consumers were looser).
 */
export const flagValueSchemas = {
  // delivery (`delivery/src/infrastructure/config.ts`)
  "delivery-enabled-environments": variantJson(NonEmptyStringListSchema),
  "delivery-enrichment-sources": variantJson(NonEmptyStringListSchema),
  "delivery-operator-logins": variantJson(NonEmptyStringListSchema),
  "delivery-executor-concurrency": variantNumber(
    z.number().int().min(1).max(64),
  ),
  "delivery-lease-seconds": variantNumber(z.number().int().min(60).max(7200)),

  // media (`media/src/infrastructure/config.ts`)
  "media-shared-discord-channel-id": variantString(
    z.union([z.literal("disabled"), SnowflakeSchema]),
  ),
  "media-session-lifetime-ms": variantNumber(
    z
      .number()
      .int()
      .min(60_000)
      .max(7 * 86_400_000),
  ),
  "media-email-sender": variantString(EmailSchema),
  "media-permitted-movie-section-id": variantString(PlexSectionIdSchema),
  "media-permitted-tv-section-id": variantString(PlexSectionIdSchema),
  "media-keep-days": variantNumber(z.number().int().min(1).max(365)),
  "media-artwork-cache-max-bytes": variantNumber(
    z
      .number()
      .int()
      .min(64 * 1024 * 1024)
      .max(1024 * 1024 * 1024 * 1024),
  ),

  // tracker (`tracker/src/infrastructure/config.ts`)
  "tracker-attachment-max-bytes": variantNumber(
    z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
  ),

  // storm forum (`storm-forum/src/config.ts`)
  "storm-forum-season": variantString(z.enum(STORM_SEASONS)),

  // birmel (`birmel/src/config/dynamic.ts`)
  "birmel-agent-auxiliary-timeout-ms": variantNumber(PositiveIntSchema),
  "birmel-agent-max-steps": variantNumber(z.number().int().min(1).max(24)),
  "birmel-agent-response-timeout-ms": variantNumber(PositiveIntSchema),
  "birmel-llm-classifier-model": variantString(ModelIdSchema),
  "birmel-llm-decisions-model": variantString(ModelIdSchema),
  "birmel-llm-decisions-threshold": variantNumber(z.number().min(0).max(1)),
  "birmel-llm-embedding-model": variantString(ModelIdSchema),
  "birmel-llm-image-model": variantString(ModelIdSchema),
  "birmel-llm-max-output-tokens": variantNumber(PositiveIntSchema),
  "birmel-llm-memory-model": variantString(ModelIdSchema),
  "birmel-llm-model": variantString(ModelIdSchema),
  "birmel-llm-reasoning-effort": variantString(
    z.enum(["minimal", "low", "medium", "high"]),
  ),
  "birmel-persona-style-model": variantString(ModelIdSchema),
  "birmel-responder-engagement-window-ms": variantNumber(PositiveIntSchema),
  "birmel-responder-transcript-max-messages": variantNumber(
    z.number().int().min(1).max(50),
  ),
  "birmel-responder-transcript-window-ms": variantNumber(PositiveIntSchema),

  // scout (`scout-for-lol/packages/backend/src/config/dynamic.ts`)
  "explore-guild-allowlist": variantString(
    commaListSchema(String.raw`\d{1,25}`, "Expected comma-separated guild ids"),
  ),
  "llm-daily-token-budget": variantNumber(PositiveIntSchema),
  "llm-hourly-token-budget": variantNumber(PositiveIntSchema),
  "scout-explore-model": variantString(ModelIdSchema),
  "scout-explore-quota-limits": variantJson(ExploreQuotaLimitsSchema),
  "scout-explore-spend-policy": variantJson(ExploreSpendPolicySchema),
  "scout-feature-tip-cooldown-hours": variantNumber(PositiveIntSchema),
  "scout-client-end-of-game-deadline-seconds": variantNumber(
    z.number().int().positive().max(3600),
  ),
  "scout-client-minimum-version": variantString(SemanticVersionSchema),
  "scout-feature-tip-percent": variantNumber(z.number().int().min(0).max(100)),
  "scout-report-ai-model": variantString(ModelIdSchema),
  "scout-riot-budget-mode": variantString(z.enum(["observe", "enforce"])),
  "scout-participant-crawl-daily-match-budget": variantNumber(
    z.number().int().nonnegative().max(1_000_000),
  ),

  // starlight-karma-bot (`starlight-karma-bot/src/config.ts`)
  "karma-admin-user-id": variantString(SnowflakeSchema),
  "karma-emoji": variantString(
    z.string().regex(/^\S+$/u, "Expected one emoji or emoji id"),
  ),

  // alert-dashboard (`alert-dashboard/src/infrastructure/digest-flag.ts`)
  "alert-dashboard-email-from": variantString(MailboxSchema),
  "alert-dashboard-email-to": variantString(EmailSchema),
  "alert-dashboard-incident-email-from": variantString(MailboxSchema),
  "alert-dashboard-incident-email-to": variantString(EmailSchema),
  "alert-dashboard-digest-email-from": variantString(MailboxSchema),
  "alert-dashboard-digest-email-to": variantString(EmailSchema),

  // temporal reports (`temporal/src/config/mail.ts`)
  "temporal-email-recipient": variantString(EmailSchema),
  "temporal-email-sender": variantString(MailboxSchema),

  // trmnl-dashboard (`trmnl-dashboard/src/dynamic-config.ts`)
  "trmnl-ha-presence-entities": variantString(HomeAssistantEntitiesSchema),
  "trmnl-ha-security-entities": variantString(HomeAssistantEntitiesSchema),
  "trmnl-ha-climate-entities": variantString(HomeAssistantEntitiesSchema),

  // storm brain (`storm-brain/src/config.ts`)
  "storm-brain-conversation-model": variantString(z.literal("gpt-6-luna")),
  "storm-brain-decisions-model": variantString(ModelIdSchema),
  "storm-brain-model": variantString(ModelIdSchema),

  // streambot (`streambot/src/config/dynamic.ts`, `media-features.ts`)
  "streambot-idle-timeout-seconds": variantNumber(PositiveIntSchema),
  "streambot-live-buffer-ms": variantNumber(
    z.number().int().min(500).max(10_000),
  ),
  "streambot-player-card-repost-after-messages":
    variantNumber(NonNegativeIntSchema),
  "streambot-player-card-tick-ms": variantNumber(NonNegativeIntSchema),
  "streambot-reconnect-delay-seconds": variantNumber(PositiveIntSchema),
  "streambot-reconnect-max-attempts": variantNumber(PositiveIntSchema),
  "streambot-subtitle-languages": variantString(
    commaListSchema("[A-Za-z0-9-]+", "Expected comma-separated language tags"),
  ),
  "streambot-music-search-provider": variantString(
    z.enum(["youtube-music", "musicbrainz"]),
  ),

  // temporal agent chat (`temporal/src/config/agent-chat.ts`, `imessage.ts`, `photon.ts`)
  "temporal-agent-chat-discord-claude-default-model":
    variantString(ModelIdSchema),
  "temporal-agent-chat-discord-codex-default-model":
    variantString(ModelIdSchema),
  "temporal-agent-chat-imessage-claude-model": variantString(ModelIdSchema),
  "temporal-agent-chat-imessage-codex-model": variantString(ModelIdSchema),
  "temporal-agent-chat-photon-owners": variantString(PhotonOwnersSchema),

  // temporal workers (`temporal/src/config/*.ts`)
  "woodpecker-log-retention-days": variantNumber(
    z.number().int().min(30).max(3650),
  ),
  "the-storm-promotion-settings": variantJson(PromotionSettingsSchema),
  "the-storm-reddit-outreach-settings": variantJson(
    RedditOutreachSettingsSchema,
  ),
  "temporal-code-review-settings": variantJson(CodeReviewSettingsSchema),

  // mail (`mail/src/server/config.ts`)
  "mail-settings": variantJson(MailSettingsSchema),
} as const satisfies Record<ManagedVariantFlagKey, VariantValueSpec>;

type FlagValueSchemas = typeof flagValueSchemas;

/** The decoded value type of a managed variant flag. */
export type FlagValueOf<K extends ManagedVariantFlagKey> =
  K extends ManagedVariantFlagKey
    ? FlagValueSchemas[K] extends VariantValueSpec<infer O, infer _I>
      ? O
      : never
    : never;
/** What `encodeVariantValue` accepts for a key (object defaults may be omitted). */
export type FlagValueInputOf<K extends ManagedVariantFlagKey> =
  K extends ManagedVariantFlagKey
    ? FlagValueSchemas[K] extends VariantValueSpec<infer _O, infer I>
      ? I
      : never
    : never;

/**
 * The registry viewed as a homomorphic mapped type, so indexing it with a
 * generic key yields that key's precise codec rather than a union.
 */
const codecs: {
  readonly [K in ManagedVariantFlagKey]: VariantValueSpec<
    FlagValueOf<K>,
    FlagValueInputOf<K>
  >;
} = flagValueSchemas;

/** Thrown by `decodeVariantValue` and `encodeVariantValue` with every issue found. */
export class VariantValueError extends Error {
  constructor(
    readonly key: ManagedVariantFlagKey,
    readonly issues: readonly VariantValueIssue[],
  ) {
    super(
      `invalid value for flag "${key}": ${issues
        .map((issue) =>
          issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`,
        )
        .join("; ")}`,
    );
    this.name = "VariantValueError";
  }
}

/** Decodes a stored variant string into its typed value, or throws `VariantValueError`. */
export function decodeVariantValue<K extends ManagedVariantFlagKey>(
  key: K,
  raw: string,
): FlagValueOf<K> {
  const decoded = codecs[key].decode(raw);
  if (!decoded.ok) throw new VariantValueError(key, decoded.issues);
  return decoded.value;
}

/** Encodes a typed value as its canonical wire string, or throws `VariantValueError`. */
export function encodeVariantValue<K extends ManagedVariantFlagKey>(
  key: K,
  value: FlagValueInputOf<K>,
): string {
  const encoded = codecs[key].encode(value);
  if (!encoded.ok) throw new VariantValueError(key, encoded.issues);
  return encoded.raw;
}

/** Checks a stored variant string against its key's schema without throwing. */
export function validateVariantValue(
  key: ManagedVariantFlagKey,
  raw: string,
): VariantValueValidation {
  const decoded = codecs[key].decode(raw);
  return decoded.ok ? { ok: true } : { ok: false, issues: decoded.issues };
}

/**
 * The schema a consumer's `defineConfig` entry uses for a variant key. It
 * accepts what config layers hand the key today — the string for `string`
 * keys; a number or decimal string for `number` keys; JSON text or an
 * already-decoded value for `json` keys — and outputs the validated decoded
 * value, so `schema: StringListSchema` becomes
 * `schema: flagValueSchema("delivery-enabled-environments")` unchanged.
 */
export function flagValueSchema<K extends ManagedVariantFlagKey>(
  key: K,
): z.ZodType<FlagValueOf<K>> {
  return codecs[key].consumerSchema();
}

/** The `createFlagConfigSource` `kinds` entry for a variant key. */
export function flagValueKind(key: ManagedVariantFlagKey): "string" | "number" {
  return flagValueSchemas[key].encoding === "number" ? "number" : "string";
}

/** The wire encoding of a variant key. */
export function flagValueEncoding(key: ManagedVariantFlagKey): VariantEncoding {
  return flagValueSchemas[key].encoding;
}

export type FlagValueJsonSchemaEntry = {
  readonly encoding: VariantEncoding;
  readonly schema: Record<string, unknown>;
};

/** Every key's encoding and decoded-value JSON Schema, sorted by key. */
export function flagValueJsonSchemas(): Record<
  string,
  FlagValueJsonSchemaEntry
> {
  return Object.fromEntries(
    Object.entries(flagValueSchemas)
      .toSorted(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, spec]) => [
        key,
        { encoding: spec.encoding, schema: jsonSchemaForSpec(spec) },
      ]),
  );
}
