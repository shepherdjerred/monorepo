import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";

const CursorSchema = z.object({ t: z.iso.datetime(), id: z.string().min(1) });
export type Cursor = { t: Date; id: string };

/** Opaque keyset position: newest-first `(timestamp, id)`. */
export function encodeCursor(position: { t: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ t: position.t.toISOString(), id: position.id }),
  ).toString("base64url");
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = CursorSchema.parse(raw);
    return { t: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new DeliveryError("INVALID", "Invalid page cursor");
  }
}

/** Prisma predicate selecting rows strictly older than the cursor. */
export function olderThan(cursor: Cursor | null, field: string) {
  if (cursor === null) return {};
  return {
    OR: [
      { [field]: { lt: cursor.t } },
      { [field]: cursor.t, id: { lt: cursor.id } },
    ],
  };
}

/** Split a `limit + 1` fetch into one page and the cursor for the next. */
export function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  time: (row: T) => Date,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last !== undefined && rows.length > limit
        ? encodeCursor({ t: time(last), id: last.id })
        : null,
  };
}

export const PAGE_SIZE = 25;
