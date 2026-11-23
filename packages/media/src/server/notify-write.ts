/** A committed command remains successful when its durable outbox dispatch is deferred. */
export async function notifyCommittedWrite(
  dependencies: {
    afterWrite?: () => Promise<void>;
    onError: (error: Error, requestId: string) => void;
  },
  requestId: string,
): Promise<void> {
  try {
    await dependencies.afterWrite?.();
  } catch {
    dependencies.onError(new Error("Outbox dispatch deferred"), requestId);
  }
}
import type { MediaActor } from "#application/auth.ts";

/** Attachment has its own transaction and can retry on an authenticated POST. */
export async function attachSeerrAfterLogin(
  dependencies: {
    migrationAdmin: {
      personal?: {
        attachImportedRequests: (actor: MediaActor) => Promise<number>;
      };
    };
    onError: (error: Error, requestId: string) => void;
  },
  actor: MediaActor,
  requestId: string,
) {
  try {
    await dependencies.migrationAdmin.personal?.attachImportedRequests(actor);
  } catch {
    dependencies.onError(
      new Error("Seerr request attachment deferred"),
      requestId,
    );
  }
}
