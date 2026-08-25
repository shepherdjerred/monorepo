/**
 * Why a delivery attempt failed.
 *
 * A leaf module: the permission checker produces this and the guild
 * permission-error store consumes it, while the checker consumes the store's
 * notify stage — declaring it beside either made the two import each other.
 */
export type DeliveryFailureKind = "permission" | "channel_missing";
