import { MY_SERVER } from "#src/configuration/flags.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

/**
 * Who may operate the durable match pipeline.
 *
 * This is authorization, so it is Git-managed: changing who can re-drive a
 * notification or resolve an unknown delivery is a reviewed commit, never a
 * Flipt ramp, a dashboard toggle or an environment variable. A feature flag
 * can only ever take the operations surface AWAY (see
 * `scout_operations_console_enabled`); it can never put someone on this list.
 *
 * Kept separate from `ME` in `configuration/flags.ts` on purpose. That constant
 * is a flag- and limit-targeting identity — "treat this account as the early
 * access cohort" — and reusing it here would silently make every targeting
 * identity an operator the day a second one is added.
 */
export const SCOUT_OPERATOR_IDS: readonly DiscordAccountId[] = [
  // Jerred — Scout's operator.
  "160509172704739328",
].map((id) => DiscordAccountIdSchema.parse(id));

const SCOUT_OPERATORS: ReadonlySet<string> = new Set(SCOUT_OPERATOR_IDS);

export const SCOUT_OPERATIONS_GUILD: DiscordGuildId =
  DiscordGuildIdSchema.parse(MY_SERVER);

/**
 * Whether an account may operate the pipeline.
 *
 * Takes the raw session id rather than a branded one so the caller cannot be
 * tempted to parse-and-trust somewhere else: an id that is not a well-formed
 * Discord account id is simply not on the list.
 */
export function isScoutOperator(discordId: DiscordAccountId): boolean {
  return SCOUT_OPERATORS.has(discordId);
}

/**
 * The acting operator, or `null` when the caller is not one.
 *
 * Returning the branded id is what lets callers use it as the intent's actor
 * without re-parsing an unvalidated session value.
 */
export function scoutOperatorId(
  discordId: DiscordAccountId,
): DiscordAccountId | null {
  return isScoutOperator(discordId)
    ? DiscordAccountIdSchema.parse(discordId)
    : null;
}
