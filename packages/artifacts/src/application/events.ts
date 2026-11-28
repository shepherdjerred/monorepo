import type { Prisma } from "#generated/prisma/client.ts";
import type { Tx } from "#infrastructure/database.ts";

export type EventInput = {
  boardId: string | null;
  kind: string;
  entityId: string;
  actorId: string;
  requestId: string;
  payload?: Prisma.InputJsonObject;
};

/**
 * Appends to the change log; the `AFTER INSERT` trigger notifies listeners
 * when the surrounding transaction commits. Payloads hold ids and numbers
 * only: never a content token, comment body or path.
 */
export async function recordEvents(tx: Tx, events: EventInput[]) {
  if (events.length === 0) return;
  await tx.event.createMany({
    data: events.map((event) => ({
      boardId: event.boardId,
      kind: event.kind,
      entityId: event.entityId,
      actorId: event.actorId,
      requestId: event.requestId,
      payload: event.payload ?? {},
    })),
  });
}
