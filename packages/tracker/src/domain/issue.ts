import type { z } from "zod";
import type { StateTypeSchema } from "#shared/schema.ts";

export function parseIdentifier(value: string): {
  teamKey: string;
  number: number;
} {
  const match = /^([A-Z][A-Z0-9]*)[- ]([1-9]\d*)$/u.exec(
    value.toUpperCase().trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error("Invalid issue identifier");
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number))
    throw new TypeError("Invalid issue number");
  return { teamKey: match[1], number };
}

export function identifier(teamKey: string, number: number): string {
  return `${teamKey}-${String(number)}`;
}

export function transitionTimestamps(
  type: z.infer<typeof StateTypeSchema>,
  previous: {
    startedAt: Date | null;
    completedAt: Date | null;
    canceledAt: Date | null;
  },
  now: Date,
) {
  return {
    startedAt: ["started", "completed"].includes(type)
      ? (previous.startedAt ?? now)
      : null,
    completedAt: type === "completed" ? (previous.completedAt ?? now) : null,
    canceledAt: ["canceled", "duplicate"].includes(type)
      ? (previous.canceledAt ?? now)
      : null,
  };
}

export function midpoint(
  before: number | undefined,
  after: number | undefined,
): number | null {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return (after ?? 0) - 1024;
  if (after === undefined) return before + 1024;
  if (after <= before) throw new Error("Invalid board neighbors");
  const next = before + (after - before) / 2;
  return next === before || next === after || after - before < 0.000001
    ? null
    : next;
}

export function searchTokens(value: string): string {
  return (
    value
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((token) => `${token}:*`)
      .join(" & ") ?? ""
  );
}
