import type { Context } from "hono";
import { routePath } from "hono/route";
import { z } from "zod";
import type { Principal } from "#shared/contract.ts";

/**
 * Prisma error codes whose cause is the database connection or a transaction
 * the database could not run to completion, not the request: retrying the
 * same request can succeed. Everything else stays an internal failure.
 *
 * - P1001/P1002/P1008/P1017: the server was unreachable, timed out or closed
 *   the connection (a restart, a failover, an overloaded pod).
 * - P2024: no connection became free from the pool in time.
 * - P2028: the interactive transaction expired or could not start in time.
 * - P2034: the transaction lost a write conflict or deadlock.
 */
export const TRANSIENT_DATABASE_CODES: ReadonlySet<string> = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  "P2034",
]);

/** Prisma's known request errors carry a `P####` code; nothing else does. */
const PrismaFailureSchema = z.object({
  code: z.string().regex(/^P\d{4}$/u),
  meta: z.unknown().optional(),
});

/** A unique-constraint violation (P2002) is a conflict the caller can act on. */
export function isUniqueViolation(error: unknown) {
  const parsed = PrismaFailureSchema.safeParse(error);
  return parsed.success && parsed.data.code === "P2002";
}

/** A database failure the same request may not meet again. */
export function isTransientDatabaseFailure(error: unknown) {
  const parsed = PrismaFailureSchema.safeParse(error);
  return parsed.success && TRANSIENT_DATABASE_CODES.has(parsed.data.code);
}

const MAX_VALUE_LENGTH = 120;

/**
 * Meta keys that name a schema object, never a value. Prisma's `meta` can also
 * hold the offending column values or the driver's message, so only these are
 * logged.
 */
const SCHEMA_KEYS = [
  "modelName",
  "target",
  "field_name",
  "column",
  "table",
  "constraint",
  "operation",
  "kind",
  "originalCode",
] as const;

/** Timings of an expired transaction (P2028): its limit and how long it ran. */
const NUMBER_KEYS = ["timeout", "timeTaken"] as const;

function schemaName(value: unknown): string | string[] | undefined {
  if (typeof value === "string")
    return value.slice(0, MAX_VALUE_LENGTH) || undefined;
  if (Array.isArray(value)) {
    const names = value.flatMap((entry): string[] =>
      typeof entry === "string" ? [entry.slice(0, MAX_VALUE_LENGTH)] : [],
    );
    return names.length === 0 ? undefined : names;
  }
  // A driver reports a constraint as `{ fields: [...] }` or `{ index: "..." }`.
  if (value !== null && typeof value === "object") {
    const record = z
      .object({
        fields: z.unknown().optional(),
        index: z.unknown().optional(),
      })
      .safeParse(value);
    if (record.success)
      return schemaName(record.data.fields) ?? schemaName(record.data.index);
  }
  return undefined;
}

type MetaValue = string | string[] | number;

function pickSchemaNames(source: unknown): Record<string, MetaValue> {
  const record = z.record(z.string(), z.unknown()).safeParse(source);
  if (!record.success) return {};
  const data = record.data;
  const entries: [string, MetaValue][] = [
    ...SCHEMA_KEYS.flatMap((key) => {
      const name = schemaName(data[key]);
      return name === undefined
        ? []
        : [[key, name] satisfies [string, MetaValue]];
    }),
    ...NUMBER_KEYS.flatMap((key) => {
      const value = data[key];
      return typeof value === "number" && Number.isFinite(value)
        ? [[key, value] satisfies [string, MetaValue]]
        : [];
    }),
  ];
  return Object.fromEntries(entries);
}

const AdapterCauseSchema = z.object({
  driverAdapterError: z.object({ cause: z.unknown() }).optional(),
});

/**
 * The schema objects a Prisma error names: its own `meta` and, under a driver
 * adapter, the driver's cause (kind, original SQLSTATE, table, column,
 * constraint). Never a column value, a query, or an error message.
 */
export function prismaMeta(meta: unknown): Record<string, MetaValue> {
  const adapter = AdapterCauseSchema.safeParse(meta);
  return {
    ...pickSchemaNames(meta),
    ...(adapter.success
      ? pickSchemaNames(adapter.data.driverAdapterError?.cause)
      : {}),
  };
}

/**
 * What the server logs for a request that failed unexpectedly. The error
 * type and, for a Prisma error, its code and the schema objects it names make
 * the failure diagnosable; the message, stack and request body stay out
 * because they can carry data and credentials.
 */
export function describeFailure(error: Error) {
  const prisma = PrismaFailureSchema.safeParse(error);
  // A system error's code (ECONNRESET, ENOMEM) names its cause without data.
  const errorCode =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    errorType: error.name,
    ...(prisma.success
      ? { code: prisma.data.code, meta: prismaMeta(prisma.data.meta) }
      : errorCode === undefined
        ? {}
        : { errorCode }),
  };
}

/**
 * The answer to a request that failed unexpectedly, after logging why: a
 * database that dropped, timed out or aborted the work is unavailable (503, so
 * the same request can be sent again); anything else is an internal failure.
 */
export function failedRequest(
  c: Context<{ Variables: { principal: Principal; requestId: string } }>,
  error: Error,
) {
  console.error(
    JSON.stringify({
      message: "delivery_request_failed",
      requestId: c.get("requestId"),
      method: c.req.method,
      route: routePath(c),
      ...describeFailure(error),
    }),
  );
  const transient = isTransientDatabaseFailure(error);
  return c.json(
    {
      error: {
        code: transient ? "UNAVAILABLE" : "INTERNAL",
        message: transient
          ? "Delivery's database was unavailable; retry the request"
          : "Delivery request failed",
        requestId: c.get("requestId"),
      },
    },
    transient ? 503 : 500,
  );
}
