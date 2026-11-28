/**
 * Storage rules shared by every Feeds store backend: input validation, the
 * managed category order, poll ordering, retention defaults, and the JSON
 * columns' parsers.
 */
import { z } from "zod";
import {
  AutoReadRuleSchema,
  EnclosureSchema,
  normalizeAutoReadRules,
  type AutoReadRule,
  type EntryView,
  type ManagedCategory,
} from "@shepherdjerred/feeds/shared/contract.ts";
import type { ParsedFeedEntry, StoreMutationFailure } from "./types.ts";

export const DEFAULT_MAX_READ_PER_FEED = 5000;
export const DEFAULT_PRUNE_MIN_AGE_SECONDS = 120 * 24 * 60 * 60;
/** A first poll's entries older than this arrive already read. */
export const STALE_POLL_ENTRY_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const MANAGED_CATEGORY_ORDER: readonly {
  readonly label: ManagedCategory;
  readonly sortOrder: number;
}[] = [
  { label: "Engineering & Infra", sortOrder: 10 },
  { label: "AI", sortOrder: 20 },
  { label: "Essays & Personal Blogs", sortOrder: 30 },
];

export const UNCATEGORIZED_LABEL = "Uncategorized";
export const UNCATEGORIZED_SORT_ORDER = 40;
export const USER_CATEGORY_SORT_ORDER = 100;

/** Entry filters shared by the console listing and mark-all-read. */
export type WhereOptions = {
  readonly view: EntryView | undefined;
  readonly category: string | undefined;
  readonly feedId: number | undefined;
  readonly q: string | undefined;
  readonly cursor?: number | undefined;
  readonly beforeId?: number | undefined;
  readonly publishedBefore?: number | undefined;
  readonly includeHidden?: boolean | undefined;
  readonly excludeStarred?: boolean | undefined;
  readonly unreadOnly?: boolean | undefined;
};

/** Whether an unscoped stream view leaves out hidden feeds. */
export function hidesHiddenFeeds(options: WhereOptions): boolean {
  const unscoped =
    options.feedId === undefined && options.category === undefined;
  const hidesStream =
    options.view === undefined ||
    options.view === "unread" ||
    options.view === "all";
  return hidesStream && unscoped && options.includeHidden !== true;
}

const EnclosuresArraySchema = z.array(EnclosureSchema);
const CategoriesArraySchema = z.array(z.string());

export function parseAutoReadJson(raw: string | null): AutoReadRule | null {
  return raw === null ? null : AutoReadRuleSchema.parse(JSON.parse(raw));
}

export function parseEnclosuresJson(
  raw: string,
): z.infer<typeof EnclosuresArraySchema> {
  return EnclosuresArraySchema.parse(JSON.parse(raw));
}

export function parseCategoriesJson(raw: string): string[] {
  return CategoriesArraySchema.parse(JSON.parse(raw));
}

/** Oldest first, and among equal timestamps the item listed last first. */
export function orderPolledEntriesChronologically(
  entries: readonly ParsedFeedEntry[],
): readonly ParsedFeedEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .toSorted(
      (a, b) => a.entry.publishedAt - b.entry.publishedAt || b.index - a.index,
    )
    .map(({ entry }) => entry);
}

export function validateHttpUrl(rawUrl: string): URL | StoreMutationFailure {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, kind: "invalid", message: "Invalid URL" };
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed
    : { ok: false, kind: "invalid", message: "URL must use http or https" };
}

export function validateOptionalAutoRead(
  rule: AutoReadRule | null | undefined,
): StoreMutationFailure | null {
  if (rule === null || rule === undefined) {
    return null;
  }
  const rules = normalizeAutoReadRules(rule);
  if (rules.length === 0) {
    return { ok: false, kind: "invalid", message: "Empty auto-read rule list" };
  }
  for (const single of rules) {
    if (single.pattern.length === 0) {
      return { ok: false, kind: "invalid", message: "Invalid auto-read regex" };
    }
    try {
      new RegExp(single.pattern, single.flags).test("");
    } catch {
      return { ok: false, kind: "invalid", message: "Invalid auto-read regex" };
    }
  }
  return null;
}
