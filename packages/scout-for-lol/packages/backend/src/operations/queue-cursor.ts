import { z } from "zod";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * Where a queue page stopped.
 *
 * Every operations queue is ordered by a timestamp and broken by an id — that
 * is what makes each read deterministic — so one position shape serves all of
 * them. The token is a keyset rather than an offset because these queues drain
 * while an operator reads them: an offset would skip rows as earlier ones were
 * resolved, and skipping is the failure this pagination exists to prevent.
 *
 * Deliberately not opaque-by-encryption. It is a position in a queue the caller
 * is already authorized to read, and a readable token is one an operator can
 * paste into a bug report. It IS validated, so a malformed or hand-edited token
 * is refused rather than silently reinterpreted as "start from the beginning",
 * which would quietly hand back page one forever.
 *
 * Mirrors `recoveryScanToken` in `database/durable/recovery-scan.ts`, which
 * encodes the same `<instant>|<id>` shape for the recovery sweep.
 */

const CURSOR_SEPARATOR = "|";

export type QueuePosition<Id extends string = string> = {
  readonly at: Date;
  readonly id: Id;
};

const QueueCursorSchema = z.strictObject({
  at: IsoInstantSchema,
  id: z.string().min(1),
});

export function encodeQueueCursor(position: QueuePosition): string {
  const token = QueueCursorSchema.parse({
    at: position.at.toISOString(),
    id: position.id,
  });
  return `${token.at}${CURSOR_SEPARATOR}${token.id}`;
}

/**
 * @throws when the token is not a `<instant>|<id>` pair. An id may not contain
 * the separator, so a token carrying more than one is ambiguous rather than
 * merely odd, and guessing which half was meant is how a cursor silently pages
 * the wrong queue position.
 *
 */
export function decodeQueueCursor(token: string): QueuePosition {
  const [at, id, ...extra] = token.split(CURSOR_SEPARATOR);
  if (extra.length > 0) {
    throw new Error(
      `Queue cursor "${token}" carries more than one "${CURSOR_SEPARATOR}": it is not an "<at>|<id>" token`,
    );
  }
  const parsed = QueueCursorSchema.parse({ at, id });
  return { at: new Date(parsed.at), id: parsed.id };
}

/**
 * Decode a cursor for a queue that breaks ties on a BRANDED key.
 *
 * `parseId` is that key's brand parser. The position comes back typed with
 * it, so the read it is handed to can demand the right key at compile time,
 * and a token carrying some other column's value — a workflow id where a
 * request key belongs — is refused here rather than compared against the
 * wrong key and quietly paging past every row that shares the boundary
 * instant.
 */
export function decodeKeyedQueueCursor<Id extends string>(
  token: string,
  parseId: (id: string) => Id,
): QueuePosition<Id> {
  const position = decodeQueueCursor(token);
  return { at: position.at, id: parseId(position.id) };
}

/**
 * Split an over-fetched page into the page itself and whether more remains.
 *
 * Asking the repository for `limit + 1` and discarding the extra is what makes
 * `hasMore` a FACT rather than a guess. Inferring it from a full page would
 * report more work whenever the backlog happened to be exactly the page size,
 * and an operator who pages into an empty queue learns nothing about whether
 * the queue drained or the count lied.
 */
export function splitOverFetchedPage<T>(
  rows: readonly T[],
  limit: number,
): { readonly items: readonly T[]; readonly hasMore: boolean } {
  return rows.length > limit
    ? { items: rows.slice(0, limit), hasMore: true }
    : { items: rows, hasMore: false };
}
