import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { TrackerError } from "#domain/error.ts";
import { DueDateSchema } from "#shared/schema.ts";

type Sql = Prisma.Sql;
const { sql, join, raw } = Prisma;

/** How one sort key crosses the wire inside a cursor and returns to SQL. */
const keyKinds = {
  // Microseconds since the epoch, as text: exact for any timestamp column.
  time: {
    schema: z.string().regex(/^-?\d{1,18}$/u),
    select: (column: Sql) =>
      sql`(extract(epoch from ${column}) * 1000000)::bigint::text`,
    bind: (value: string | number | boolean) =>
      sql`(timestamp 'epoch' + ${value}::bigint * interval '1 microsecond')`,
  },
  int: {
    schema: z.number().int().min(0).max(2_147_483_647),
    select: (column: Sql) => sql`${column}::int`,
    bind: (value: string | number | boolean) => sql`${value}::int`,
  },
  float: {
    schema: z.number(),
    select: (column: Sql) => sql`${column}::float8`,
    bind: (value: string | number | boolean) => sql`${value}::float8`,
  },
  bool: {
    schema: z.boolean(),
    select: (column: Sql) => sql`${column}::boolean`,
    bind: (value: string | number | boolean) => sql`${value}::boolean`,
  },
  date: {
    schema: DueDateSchema,
    select: (column: Sql) => sql`to_char(${column}, 'YYYY-MM-DD')`,
    bind: (value: string | number | boolean) => sql`${value}::date`,
  },
  text: {
    schema: z.string().max(1000),
    select: (column: Sql) => sql`${column}::text`,
    bind: (value: string | number | boolean) => sql`${value}::text`,
  },
} as const;

type SortKeyKind = keyof typeof keyKinds;
export type SortKey<K extends SortKeyKind = SortKeyKind> = {
  expr: Sql;
  desc: boolean;
  kind: K;
};

type KeysetPlan<K extends SortKeyKind = SortKeyKind> = {
  order: string;
  keys: readonly SortKey<K>[];
};

const CursorSchema = z.strictObject({
  o: z.string(),
  k: z.array(z.union([z.string(), z.number(), z.boolean()])).max(8),
  id: z.string().min(1).max(200),
});
type Cursor = z.infer<typeof CursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidCursor(): TrackerError {
  return new TrackerError(
    "BAD_REQUEST",
    "Invalid cursor: restart the list from its first page",
  );
}

function decodeCursor(plan: KeysetPlan, value: string): Cursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const cursor = CursorSchema.safeParse(decoded);
  if (
    !cursor.success ||
    cursor.data.o !== plan.order ||
    cursor.data.k.length !== plan.keys.length ||
    plan.keys.some(
      (key, index) =>
        !keyKinds[key.kind].schema.safeParse(cursor.data.k[index]).success,
    )
  ) {
    throw invalidCursor();
  }
  return cursor.data;
}

const sortAlias = (index: number) => raw(`"k${String(index)}"`);
const sortColumn = (index: number) => raw(`q."k${String(index)}"`);

/** Rows that sort strictly after the cursor under the plan's ordering. */
function afterCursor(plan: KeysetPlan, cursor: Cursor): Sql {
  let condition = sql`q."id" > ${cursor.id}`;
  for (const [index, key] of [...plan.keys.entries()].reverse()) {
    const value = cursor.k[index];
    if (value === undefined) throw invalidCursor();
    const bound = keyKinds[key.kind].bind(value);
    const beyond = key.desc
      ? sql`${sortColumn(index)} < ${bound}`
      : sql`${sortColumn(index)} > ${bound}`;
    condition = sql`(${beyond} OR (${sortColumn(index)} = ${bound} AND ${condition}))`;
  }
  return condition;
}

/** Build outer SELECT, inner SELECT, WHERE, and ORDER BY fragments for a keyset query. */
export function keysetSqlParts(
  plan: KeysetPlan,
  rawCursor: string | undefined,
) {
  const cursor =
    rawCursor === undefined ? undefined : decodeCursor(plan, rawCursor);
  const keys = [...plan.keys.entries()];
  return {
    outerSelect: join(
      keys.map(
        ([index, key]) =>
          sql`${keyKinds[key.kind].select(sortColumn(index))} AS ${sortAlias(index)}`,
      ),
    ),
    innerSelect: join(
      keys.map(([index, key]) => sql`${key.expr} AS ${sortAlias(index)}`),
    ),
    whereAfter: cursor === undefined ? sql`TRUE` : afterCursor(plan, cursor),
    orderBy: join([
      ...keys.map(
        ([index, key]) =>
          sql`${sortColumn(index)} ${key.desc ? sql`DESC` : sql`ASC`}`,
      ),
      sql`q."id" ASC`,
    ]),
  };
}

/** Slice fetched keyset rows (`limit + 1` or `"all"`) into IDs and `nextCursor`. */
export function sliceKeysetRows(
  plan: KeysetPlan,
  rows: readonly Record<string, unknown>[],
  limit: number | "all",
): { ids: string[]; nextCursor: string | null } {
  const more = limit !== "all" && rows.length > limit;
  const served = limit === "all" ? rows : rows.slice(0, limit);
  const last = served.at(-1);
  const keys = [...plan.keys.entries()];
  return {
    ids: served.map((row) => z.string().parse(row["id"])),
    nextCursor:
      more && last !== undefined
        ? encodeCursor({
            o: plan.order,
            k: keys.map(([index, key]) =>
              keyKinds[key.kind].schema.parse(last[`k${String(index)}`]),
            ),
            id: z.string().parse(last["id"]),
          })
        : null,
  };
}
