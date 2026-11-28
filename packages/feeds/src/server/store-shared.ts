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
  type CreateUserFeedBody,
  type EntryView,
  type ManagedCategory,
  type UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import type {
  ParsedFeedEntry,
  StoredFeed,
  StoreMutationFailure,
} from "./types.ts";

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

/**
 * Checks a new user feed's fields in the order the stores always reported
 * them, and returns the URL's host for a default title.
 */
export function validateNewUserFeed(
  body: CreateUserFeedBody,
): { readonly host: string } | StoreMutationFailure {
  const urlCheck = validateHttpUrl(body.url);
  if ("ok" in urlCheck) {
    return urlCheck;
  }
  const htmlCheck =
    body.htmlUrl === undefined ? undefined : validateHttpUrl(body.htmlUrl);
  if (htmlCheck !== undefined && "ok" in htmlCheck) {
    return htmlCheck;
  }
  const ruleErr = validateOptionalAutoRead(body.autoRead);
  if (ruleErr !== null) {
    return ruleErr;
  }
  return body.category.trim() === ""
    ? { ok: false, kind: "invalid", message: "Category cannot be empty" }
    : { host: urlCheck.host };
}

/** A user feed that exists and may be changed, or why it may not. */
export function requireUserFeed(
  existing: StoredFeed | undefined,
  action: "modified" | "deleted",
): StoredFeed | StoreMutationFailure {
  if (existing === undefined) {
    return { ok: false, kind: "not-found", message: "Feed not found" };
  }
  return existing.source === "user"
    ? existing
    : {
        ok: false,
        kind: "forbidden",
        message: `Code-managed feeds cannot be ${action}`,
      };
}

/**
 * Checks an edit's fields in the stores' order: URL, URL ownership, site
 * URL, then auto-read rule. `urlOwnerId` is the feed that already has
 * `body.url`, if any.
 */
export function validateUserFeedEdit(input: {
  readonly id: number;
  readonly body: UpdateUserFeedBody;
  readonly urlOwnerId: number | undefined;
}): StoreMutationFailure | null {
  const { id, body, urlOwnerId } = input;
  if (body.url !== undefined) {
    const check = validateHttpUrl(body.url);
    if ("ok" in check) {
      return check;
    }
    if (urlOwnerId !== undefined && urlOwnerId !== id) {
      return {
        ok: false,
        kind: "conflict",
        message: "Feed URL already exists",
      };
    }
  }
  if (body.htmlUrl !== undefined && body.htmlUrl !== null) {
    const check = validateHttpUrl(body.htmlUrl);
    if ("ok" in check) {
      return check;
    }
  }
  return validateOptionalAutoRead(body.autoRead);
}
