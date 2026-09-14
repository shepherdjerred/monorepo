import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { MY_SERVER } from "#src/configuration/flags.ts";

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

/**
 * The guild operations actions are attributed to.
 *
 * Operating the pipeline is global rather than per-server, but a confirmation
 * intent and an audit row both require a guild by schema, so attribution needs
 * one. This is the same control guild the existing bearer-token operations
 * route already attributes its actions to
 * (`http/weekly-parlay-control.ts`), rather than a second constant that could
 * drift away from it.
 *
 * It is attribution ONLY. No operations check consults it, and membership in
 * it grants nothing — {@link isScoutOperator} is the whole access decision.
 *
 * Re-parsed rather than aliased so this is a declaration of its own: the value
 * still comes from the one place that owns it, but the operations layer does
 * not become a second export site for someone else's constant.
 */
export const SCOUT_OPERATIONS_GUILD: DiscordGuildId =
  DiscordGuildIdSchema.parse(MY_SERVER);

/**
 * Whether an account may operate the pipeline.
 *
 * Takes the raw session id rather than a branded one so the caller cannot be
 * tempted to parse-and-trust somewhere else: an id that is not a well-formed
 * Discord account id is simply not on the list.
 */
export function isScoutOperator(discordId: string): boolean {
  return SCOUT_OPERATORS.has(discordId);
}

/**
 * The acting operator, or `null` when the caller is not one.
 *
 * Returning the branded id is what lets callers use it as the intent's actor
 * without re-parsing an unvalidated session value.
 */
export function scoutOperatorId(discordId: string): DiscordAccountId | null {
  return isScoutOperator(discordId)
    ? DiscordAccountIdSchema.parse(discordId)
    : null;
}
