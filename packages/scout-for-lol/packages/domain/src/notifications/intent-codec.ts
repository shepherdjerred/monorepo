import { z } from "zod";
import { defineVersionedCodec } from "#src/codec/versioned.ts";
import {
  NotificationIntentSchema,
  type NotificationIntentKind,
} from "#src/notifications/intent.ts";

/**
 * Wire codec for a persisted notification intent. The envelope is
 * `{ kind: "notification-intent", version, data }`; older versions migrate
 * forward inside `parse`.
 *
 * ## Version 2
 *
 * Version 3 added the optional `announcement` envelope for the two kinds that
 * carry one; every version-2 payload is a report kind, which carries none, so
 * the step is the identity and exists to say that the shape changed.
 *
 * Version 1 carried neither `kind` (what the intent announces) nor `origin`
 * (where the decision came from). Every version-1 payload was minted by one
 * of two live producers — v1's delivery recorder and the V2 prematch capture
 * — and both key their intents under a prefix that names the kind, so the
 * migration derives `kind` from that prefix and stamps the origin `live`. A
 * version-1 key under any other prefix is not something those producers ever
 * wrote, and the migration refuses it rather than guess: a wrong kind would
 * render a game-start announcement as a post-match report.
 */

const LEGACY_KEY_PREFIX_KINDS: readonly (readonly [
  prefix: string,
  kind: NotificationIntentKind,
])[] = [
  ["postmatch-discord:", "postmatch"],
  ["prematch-discord:", "prematch"],
];

const LegacyIntentKeySchema = z.object({ key: z.string().min(1) });

function migrateVersion1(old: unknown): unknown {
  const { key } = LegacyIntentKeySchema.parse(old);
  const match = LEGACY_KEY_PREFIX_KINDS.find(([prefix]) =>
    key.startsWith(prefix),
  );
  if (match === undefined) {
    throw new Error(
      `A version-1 notification intent carries key ${key}, which names no kind this codec can migrate`,
    );
  }
  return {
    ...z.record(z.string(), z.unknown()).parse(old),
    kind: match[1],
    origin: { kind: "live" },
  };
}

export const notificationIntentCodec = defineVersionedCodec({
  kind: "notification-intent",
  version: 3,
  schema: NotificationIntentSchema,
  migrations: { 1: migrateVersion1, 2: (old) => old },
});
