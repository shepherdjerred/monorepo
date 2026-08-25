/**
 * Why a delivery attempt failed.
 *
 * A leaf module, kept apart from both the permission checker that produces it
 * and the guild permission-error store that consumes it, because the checker
 * also consumes the store's notify stage — declaring it beside either made the
 * two import each other.
 *
 * It sits under `database/` rather than `discord/` because it is the store's
 * column vocabulary: the persisted escalation state is keyed by it. Declaring
 * it under the transport made the persistence layer depend on Discord for the
 * shape of something only the database records.
 */
export type DeliveryFailureKind = "permission" | "channel_missing";
