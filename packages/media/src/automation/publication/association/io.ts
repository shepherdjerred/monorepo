import { ZodError } from "zod";
import { IntegrationError } from "#integrations/http.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PlexBindingReason } from "#shared/plex-binding/contract.ts";
import type { AssociationContext } from "./types.ts";

export function assertAssociationActive(context: AssociationContext): void {
  context.execution.signal.throwIfAborted();
  context.execution.assertActive();
  context.freshness.assertActive();
}

/** Only errors from the external parser/transport become protected observations. */
export async function plexRead<T>(
  context: AssociationContext,
  read: () => Promise<T>,
  invalid: PlexBindingReason,
): Promise<T> {
  assertAssociationActive(context);
  let result: T;
  try {
    result = await read();
  } catch (error) {
    assertAssociationActive(context);
    if (error instanceof ZodError) {
      throw new PlexBindingProtection(invalid);
    }
    if (error instanceof IntegrationError) {
      throw new PlexBindingProtection(
        error.kind === "invalid-response" ? invalid : "inaccessible",
      );
    }
    throw error;
  }
  assertAssociationActive(context);
  await context.execution.checkpoint();
  assertAssociationActive(context);
  return result;
}
