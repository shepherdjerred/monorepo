import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type { FlagsActorWire } from "@shepherdjerred/feature-flags/flags-wire.ts";
import type {
  FlagMetadata,
  HistoryEntry,
} from "@shepherdjerred/flags/client/management-api.ts";
import {
  reviewText,
  sameFlag,
  valueIssues,
  valueKind,
} from "@shepherdjerred/flags/client/model.ts";
import { FlagValueSchema } from "@shepherdjerred/flags/schema.ts";

/**
 * Who wrote: a human's tailnet login, a machine's advisory label (e.g.
 * `toolkit`, or `unknown` when it sent none) or the system's `seed`. Each is
 * the actor's id.
 */
export function actorLabel(actor: FlagsActorWire): string {
  return actor.id;
}

const ACTOR_KIND: Readonly<Record<FlagsActorWire["kind"], string>> = {
  human: "Operator login",
  machine: "Machine token (label is advisory)",
  system: "System",
};

/** A tooltip saying what kind of actor a label names. */
export function actorTitle(actor: FlagsActorWire): string {
  return ACTOR_KIND[actor.kind];
}

export const ACTION_LABEL: Readonly<Record<HistoryEntry["action"], string>> = {
  create: "Created",
  update: "Updated",
  retire: "Retired",
};

/** An audit instant in UTC to the minute, e.g. `2026-11-20 14:03 UTC`. */
export function formatInstant(iso: string): string {
  const instant = new Date(iso).toISOString();
  return `${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC`;
}

/** A calendar date, e.g. `2026-09-01`; legacy dates are git commit days. */
export function formatDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * How long ago `iso` was, from `now`: "just now", "3 hours ago", "yesterday".
 * A time after `now` (a write since the page measured it) is "just now".
 */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 1000),
  );
  for (const [unit, size] of UNITS) {
    if (seconds >= size)
      return RELATIVE.format(-Math.trunc(seconds / size), unit);
  }
  return "just now";
}

/**
 * When the key was added, worded by how the date is known: a recorded
 * `create` is exact; a legacy date is the day the inventory first declared it
 * (or a bound, for keys in the inventory's first commit); without either it
 * predates the audit trail.
 */
export function addedText(meta: FlagMetadata, auditStartedAt: string): string {
  if (meta.createdAt === null || meta.createdAtBasis === "unknown")
    return `Added before audit (${formatInstant(auditStartedAt)})`;
  switch (meta.createdAtBasis) {
    case "recorded": {
      return `Added ${formatInstant(meta.createdAt)}`;
    }
    case "first-declared": {
      return `Added: first declared ${formatDay(meta.createdAt)}`;
    }
    case "on-or-before": {
      return `Added on or before ${formatDay(meta.createdAt)}`;
    }
  }
}

/** "Last changed 3 hours ago by toolkit", when a change is recorded. */
export function lastChangedText(
  meta: FlagMetadata,
  now: number,
): string | undefined {
  return meta.lastChangedAt === null || meta.lastChangedBy === null
    ? undefined
    : `Last changed ${relativeTime(meta.lastChangedAt, now)} by ${actorLabel(meta.lastChangedBy)}`;
}

/**
 * A stored body as review text: a body that is a flag today reads the way the
 * review dialog shows it (a `json` variant decoded); any other body is pretty
 * JSON, and an absent one is empty.
 */
export function bodyText(body: unknown): string {
  if (body === null || body === undefined) return "";
  const parsed = FlagValueSchema.safeParse(body);
  return parsed.success
    ? reviewText(parsed.data)
    : JSON.stringify(body, undefined, 2);
}

/** A retired flag's last value: a variant's value, a boolean's whole flag. */
export function finalText(final: unknown): string {
  const parsed = FlagValueSchema.safeParse(final);
  if (!parsed.success) return bodyText(final);
  const flag = parsed.data;
  const kind = valueKind(flag);
  return flag.type === "variant" &&
    !(kind.kind === "managed" && kind.encoding === "json")
    ? flag.value
    : reviewText(flag);
}

export type RestoreCheck =
  | { readonly ok: true; readonly flag: FlagValue }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether an entry's `after` can become the draft: it must be a flag under
 * today's schema, the stored flag's type and key, pass the value registry and
 * differ from what is stored. Saving it still goes through review at the
 * editor's current revision.
 */
export function restoreCheck(
  entry: HistoryEntry,
  stored: FlagValue,
): RestoreCheck {
  if (entry.action === "retire")
    return { ok: false, reason: "A retirement has no value to restore." };
  const parsed = FlagValueSchema.safeParse(entry.after);
  if (!parsed.success)
    return {
      ok: false,
      reason: "This version does not match today's flag schema.",
    };
  const flag = parsed.data;
  if (flag.key !== stored.key)
    return { ok: false, reason: `This version is for key ${flag.key}.` };
  if (flag.type !== stored.type)
    return {
      ok: false,
      reason: `This version is a ${flag.type} flag; the stored flag is a ${stored.type} flag.`,
    };
  const [issue] = valueIssues(flag);
  if (issue !== undefined)
    return {
      ok: false,
      reason: `This version fails the value registry today: ${issue.message}`,
    };
  return sameFlag(flag, stored)
    ? { ok: false, reason: "This version is the stored value." }
    : { ok: true, flag };
}
