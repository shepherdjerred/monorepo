import { defineVersionedCodec } from "#src/codec/versioned.ts";
import { NotificationIntentSchema } from "#src/notifications/intent.ts";

/**
 * Wire codec for a persisted notification intent. The envelope is
 * `{ kind: "notification-intent", version, data }`; older versions migrate
 * forward inside `parse`.
 */
export const notificationIntentCodec = defineVersionedCodec({
  kind: "notification-intent",
  version: 1,
  schema: NotificationIntentSchema,
});
