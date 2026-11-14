import type { z } from "zod";
import {
  HistoryAgentNameSchema,
  type HistoryAgentName,
} from "#lib/history/agents.ts";
import { parseSince } from "#lib/history/query/query.ts";
import {
  HistorySourceNameSchema,
  type HistorySourceName,
} from "#lib/history/types.ts";

/**
 * Query-string parsing shared by the read API and the CLI commands that print
 * the same responses, so both reject the same input the same way.
 */

/** A request the client got wrong; the API answers it with HTTP 400. */
export class BadRequest extends Error {}

/** A missing record; the API answers it with HTTP 404. */
export class NotFound extends Error {}

/** Absent means `fallback`; otherwise the CLI's `--since` grammar. */
export function sinceParam(
  params: URLSearchParams,
  now: Date,
  fallback: string | null = null,
): string | null {
  const raw = params.get("since") ?? fallback;
  if (raw === null) {
    return null;
  }
  try {
    return parseSince(raw, now);
  } catch (error: unknown) {
    throw new BadRequest(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function sourceParam(params: URLSearchParams): HistorySourceName | null {
  const raw = params.get("source");
  if (raw === null) {
    return null;
  }
  const parsed = HistorySourceNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(`Unknown history source "${raw}"`);
  }
  return parsed.data;
}

export function agentParam(params: URLSearchParams): HistoryAgentName | null {
  const raw = params.get("agent");
  if (raw === null) {
    return null;
  }
  const parsed = HistoryAgentNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(
      `Unknown agent "${raw}"; use one of ${HistoryAgentNameSchema.options.join(", ")}`,
    );
  }
  return parsed.data;
}

/** One value of `schema`'s enum, or `fallback` when absent. */
export function enumParam<T extends string>(
  params: URLSearchParams,
  name: string,
  schema: z.ZodEnum<Record<T, T>>,
  fallback: T,
): T {
  const raw = params.get(name);
  if (raw === null) {
    return fallback;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(`${name} must be one of ${schema.options.join(", ")}`);
  }
  return parsed.data;
}

export function booleanParam(params: URLSearchParams, name: string): boolean {
  const raw = params.get(name);
  if (raw === null || raw === "false") {
    return false;
  }
  if (raw === "true") {
    return true;
  }
  throw new BadRequest(`${name} must be true or false`);
}
