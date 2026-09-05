import {
  ConfirmationIntentPayloadSchema,
  type ConfirmationIntentPayload,
} from "@scout-for-lol/data";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";

/**
 * Read an intent's stored payload, proving it agrees with the row's `kind`.
 *
 * The discriminator is stored twice on purpose: the `kind` column is what
 * queries, indexes and status responses read, while the copy inside `payload`
 * is what makes the payload a discriminated union its consumers can narrow.
 * `createConfirmationIntent` derives the column from the payload, so the mint
 * path cannot produce a disagreement — but a migration, an administrative
 * repair, or a future writer could.
 *
 * Trusting either side alone is what makes that dangerous. A row whose column
 * says one kind and whose payload says another would be reported to the user
 * as the first and executed as the second, and on `dare_fund` or
 * `dare_contribute` the executed one moves real balances. So a mismatch is a
 * hard failure rather than a silent preference for one column over the other.
 */
export function readConfirmationIntentPayload(
  intent: Pick<ConfirmationIntent, "id" | "kind" | "payload">,
): ConfirmationIntentPayload {
  const payload = ConfirmationIntentPayloadSchema.parse(
    JSON.parse(intent.payload),
  );
  if (payload.kind !== intent.kind) {
    throw new Error(
      `Confirmation intent ${intent.id} stores kind "${intent.kind}" but its payload declares "${payload.kind}".`,
    );
  }
  return payload;
}
