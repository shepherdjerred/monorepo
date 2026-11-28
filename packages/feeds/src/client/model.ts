import type { Figure, Severity } from "@shepherdjerred/console-ui";
import {
  normalizeAutoReadRules,
  type AutoReadRule,
  type CreateUserFeedBody,
  type EntryView,
  type FeedHealthItem,
  type MarkAllReadBody,
  type SummaryResponse,
  type UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";

export type EntriesRoute = {
  readonly kind: "entries";
  readonly view: EntryView;
  readonly category?: string;
  readonly feedId?: number;
};

export type FeedsRoute = {
  readonly kind: "feeds";
};

export type Route = EntriesRoute | FeedsRoute;

const POSITIVE_INT = /^[1-9]\d*$/u;

const SINGLE_SEGMENT_ROUTES: Readonly<Record<string, Route>> = {
  all: { kind: "entries", view: "all" },
  starred: { kind: "entries", view: "starred" },
  "auto-read": { kind: "entries", view: "auto-read" },
  feeds: { kind: "feeds" },
};

function safeDecode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function parseCategoryRoute(
  rawLabel: string,
  search: string,
): EntriesRoute | undefined {
  const category = safeDecode(rawLabel);
  if (category === undefined || category.length === 0) return undefined;
  const viewParam = new URLSearchParams(search).get("view");
  const view: EntryView = viewParam === "all" ? "all" : "unread";
  return { kind: "entries", view, category };
}

function parseFeedRoute(rawId: string): EntriesRoute | undefined {
  if (!POSITIVE_INT.test(rawId)) return undefined;
  const feedId = Number(rawId);
  return Number.isSafeInteger(feedId)
    ? { kind: "entries", view: "all", feedId }
    : undefined;
}

export function parseRoute(pathname: string, search = ""): Route | undefined {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return { kind: "entries", view: "unread" };
  }
  if (parts.length === 1) {
    const first = parts[0];
    return first === undefined ? undefined : SINGLE_SEGMENT_ROUTES[first];
  }
  if (parts.length === 2) {
    const [prefix, rawParam] = parts;
    if (rawParam === undefined) return undefined;
    if (prefix === "category") return parseCategoryRoute(rawParam, search);
    if (prefix === "feed") return parseFeedRoute(rawParam);
  }
  return undefined;
}

export function routePath(route: Route): string {
  if (route.kind === "feeds") return "/feeds";
  if (route.feedId !== undefined) return `/feed/${String(route.feedId)}`;
  if (route.category !== undefined) {
    return `/category/${encodeURIComponent(route.category)}`;
  }
  switch (route.view) {
    case "unread":
      return "/";
    case "all":
      return "/all";
    case "starred":
      return "/starred";
    case "auto-read":
      return "/auto-read";
  }
}

export function parseSearch(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}

export function searchSuffix(query: string, currentSearch = ""): string {
  const params = new URLSearchParams();
  if (new URLSearchParams(currentSearch).get("view") === "all") {
    params.set("view", "all");
  }
  const needle = query.trim();
  if (needle.length > 0) {
    params.set("q", needle);
  }
  const encoded = params.toString();
  return encoded.length === 0 ? "" : `?${encoded}`;
}

export function routeHref(route: Route, query = ""): string {
  const path = routePath(route);
  if (route.kind === "feeds") return path;
  const params = new URLSearchParams();
  if (route.category !== undefined && route.view === "all") {
    params.set("view", "all");
  }
  const needle = query.trim();
  if (needle.length > 0) {
    params.set("q", needle);
  }
  const encoded = params.toString();
  return encoded.length === 0 ? path : `${path}?${encoded}`;
}

export function isSameNavTarget(
  route: Route | undefined,
  target: Route,
): boolean {
  if (route?.kind !== target.kind) return false;
  if (route.kind === "feeds" && target.kind === "feeds") return true;
  if (route.kind !== "entries" || target.kind !== "entries") return false;
  if (route.category !== undefined || target.category !== undefined) {
    return route.category === target.category && target.feedId === undefined;
  }
  return route.feedId === undefined && target.feedId === undefined
    ? route.view === target.view
    : route.feedId === target.feedId;
}

export function routeTitle(
  route: Route,
  feeds?: readonly Pick<FeedHealthItem, "id" | "title">[],
): string {
  if (route.kind === "feeds") return "Feeds & Health";
  if (route.feedId !== undefined) {
    const match = feeds?.find((feed) => feed.id === route.feedId);
    return match === undefined ? `Feed #${String(route.feedId)}` : match.title;
  }
  if (route.category !== undefined) return route.category;
  switch (route.view) {
    case "unread":
      return "Unread";
    case "all":
      return "All";
    case "starred":
      return "Starred";
    case "auto-read":
      return "Auto-read";
  }
}

export function formatIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

export function formatRelativeTime(
  epochSeconds: number | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (epochSeconds === null) return "Never";
  const elapsed = Math.max(0, nowSeconds - epochSeconds);
  if (elapsed < 60) return "just now";
  if (elapsed < 3600) return `${String(Math.floor(elapsed / 60))}m ago`;
  if (elapsed < 86_400) return `${String(Math.floor(elapsed / 3600))}h ago`;
  return elapsed < 86_400 * 30
    ? `${String(Math.floor(elapsed / 86_400))}d ago`
    : formatIsoTimestamp(epochSeconds).slice(0, 10);
}

export function entryHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export type FeedStatusBadge = {
  readonly severity: Severity;
  readonly label: string;
};

export function feedHealthStatus(
  feed: Pick<
    FeedHealthItem,
    "lastStatus" | "consecutiveFailures" | "lastPolledAt"
  >,
): FeedStatusBadge {
  if (feed.consecutiveFailures >= 3) {
    return { severity: "error", label: "Critical" };
  }
  if (feed.consecutiveFailures > 0) {
    return { severity: "warning", label: "Warning" };
  }
  if (feed.lastStatus === 200 || feed.lastStatus === 304) {
    return { severity: "ok", label: "OK" };
  }
  if (feed.lastPolledAt === null || feed.lastStatus === null) {
    return { severity: "unknown", label: "Pending" };
  }
  return {
    severity: "warning",
    label: `HTTP ${String(feed.lastStatus)}`,
  };
}

export function formatAutoReadBadge(rule: AutoReadRule): string {
  const rules = normalizeAutoReadRules(rule);
  const first = rules[0];
  if (first !== undefined && rules.length === 1) {
    const prefix = first.negate === true ? "!~" : "~";
    const fieldPrefix = first.field === "title" ? "" : `${first.field} `;
    const pat =
      first.pattern.length > 48
        ? `${first.pattern.slice(0, 45)}…`
        : first.pattern;
    return `${fieldPrefix}${prefix} /${pat}/${first.flags}`;
  }
  const fields = [...new Set(rules.map((r) => r.field))].join(", ");
  return `${String(rules.length)} rules (${fields})`;
}

export function sortFeedsForHealth(
  feeds: readonly FeedHealthItem[],
): FeedHealthItem[] {
  return [...feeds].toSorted((a, b) => {
    const aFail = a.consecutiveFailures > 0 ? 1 : 0;
    const bFail = b.consecutiveFailures > 0 ? 1 : 0;
    if (aFail !== bFail) return bFail - aFail;
    if (a.consecutiveFailures !== b.consecutiveFailures) {
      return b.consecutiveFailures - a.consecutiveFailures;
    }
    return a.source === b.source
      ? a.title.localeCompare(b.title)
      : a.source === "user"
        ? -1
        : 1;
  });
}

export type UserFeedDraft = {
  readonly url: string;
  readonly title: string;
  readonly category: string;
  readonly htmlUrl: string;
  readonly hidden: boolean;
  readonly autoReadPattern: string;
  readonly autoReadFlags: "" | "i";
  readonly autoReadNegate: boolean;
  readonly initialAutoRead?: AutoReadRule | null | undefined;
};

export type UserFeedField =
  "url" | "title" | "category" | "htmlUrl" | "autoReadPattern";

export type UserFeedErrors = Partial<Record<UserFeedField, string>>;

const EMPTY_TITLE_RULE = {
  pattern: "",
  flags: "i" as const,
  negate: false,
};

function extractEditableTitleRule(rule: AutoReadRule | null | undefined): {
  readonly pattern: string;
  readonly flags: "" | "i";
  readonly negate: boolean;
} {
  if (rule === null || rule === undefined) return EMPTY_TITLE_RULE;
  const rules = normalizeAutoReadRules(rule);
  const first = rules[0];
  return first !== undefined && rules.length === 1 && first.field === "title"
    ? {
        pattern: first.pattern,
        flags: first.flags,
        negate: first.negate ?? false,
      }
    : EMPTY_TITLE_RULE;
}

export function emptyUserFeedDraft(): UserFeedDraft {
  return {
    url: "",
    title: "",
    category: "Uncategorized",
    htmlUrl: "",
    hidden: false,
    autoReadPattern: "",
    autoReadFlags: "i",
    autoReadNegate: false,
  };
}

export function draftFromFeed(feed: FeedHealthItem): UserFeedDraft {
  const editable = extractEditableTitleRule(feed.autoRead);
  return {
    // Never populate stored URL into browser DOM state so secret tokens do not round-trip.
    url: "",
    title: feed.title,
    category: feed.category,
    htmlUrl: feed.htmlUrl ?? "",
    hidden: feed.hidden,
    autoReadPattern: editable.pattern,
    autoReadFlags: editable.flags,
    autoReadNegate: editable.negate,
    initialAutoRead: feed.autoRead,
  };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateUrlValue(
  rawUrl: string,
  required: boolean,
  invalidMessage: string,
): string | undefined {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return required ? "Enter an http:// or https:// feed URL." : undefined;
  }
  return isValidHttpUrl(trimmed) ? undefined : invalidMessage;
}

function validateTitleValue(
  rawTitle: string,
  required: boolean,
): string | undefined {
  const trimmed = rawTitle.trim();
  if (required && trimmed.length === 0) return "Enter a feed title.";
  return trimmed.length > 200
    ? "Title must be 200 characters or fewer."
    : undefined;
}

function validateCategoryValue(rawCategory: string): string | undefined {
  const trimmed = rawCategory.trim();
  if (trimmed.length === 0) return "Enter a category name.";
  return trimmed.length > 100
    ? "Category must be 100 characters or fewer."
    : undefined;
}

function validatePatternValue(
  pattern: string,
  flags: "" | "i",
): string | undefined {
  if (pattern.length === 0) return undefined;
  try {
    new RegExp(pattern, flags);
    return undefined;
  } catch {
    return "Enter a valid regular expression pattern.";
  }
}

export function validateUserFeedField(
  draft: UserFeedDraft,
  field: UserFeedField,
  mode: "create" | "edit",
): string | undefined {
  switch (field) {
    case "url":
      return validateUrlValue(
        draft.url,
        mode === "create",
        "Enter a valid http:// or https:// URL.",
      );
    case "title":
      return validateTitleValue(draft.title, mode === "edit");
    case "category":
      return validateCategoryValue(draft.category);
    case "htmlUrl":
      return validateUrlValue(
        draft.htmlUrl,
        false,
        "Enter a valid http:// or https:// site URL.",
      );
    case "autoReadPattern":
      return validatePatternValue(draft.autoReadPattern, draft.autoReadFlags);
  }
}

export function validateUserFeedDraft(
  draft: UserFeedDraft,
  mode: "create" | "edit",
): UserFeedErrors {
  const errors: UserFeedErrors = {};
  for (const field of [
    "url",
    "title",
    "category",
    "htmlUrl",
    "autoReadPattern",
  ] as const) {
    const message = validateUserFeedField(draft, field, mode);
    if (message !== undefined) errors[field] = message;
  }
  return errors;
}

function buildAutoReadRule(draft: UserFeedDraft): AutoReadRule | null {
  return draft.autoReadPattern.length === 0
    ? null
    : {
        field: "title",
        pattern: draft.autoReadPattern,
        flags: draft.autoReadFlags,
        ...(draft.autoReadNegate ? { negate: true } : {}),
      };
}

export function toCreateUserFeedBody(draft: UserFeedDraft): CreateUserFeedBody {
  const title = draft.title.trim();
  const htmlUrl = draft.htmlUrl.trim();
  const autoRead = buildAutoReadRule(draft);
  return {
    url: draft.url.trim(),
    ...(title.length > 0 ? { title } : {}),
    category: draft.category.trim(),
    ...(htmlUrl.length > 0 ? { htmlUrl } : {}),
    hidden: draft.hidden,
    autoRead,
  };
}

export function toUpdateUserFeedBody(draft: UserFeedDraft): UpdateUserFeedBody {
  const url = draft.url.trim();
  const htmlUrl = draft.htmlUrl.trim();
  const baseline = extractEditableTitleRule(draft.initialAutoRead);
  const autoReadUnchanged =
    draft.initialAutoRead !== undefined &&
    draft.autoReadPattern === baseline.pattern &&
    draft.autoReadFlags === baseline.flags &&
    draft.autoReadNegate === baseline.negate;
  return {
    title: draft.title.trim(),
    category: draft.category.trim(),
    ...(url.length > 0 ? { url } : {}),
    htmlUrl: htmlUrl.length > 0 ? htmlUrl : null,
    hidden: draft.hidden,
    ...(autoReadUnchanged ? {} : { autoRead: buildAutoReadRule(draft) }),
  };
}

export function buildMarkAllReadBody(
  route: EntriesRoute,
  query: string,
  beforeId: number,
): MarkAllReadBody {
  const trimmed = query.trim();
  return {
    view: route.view,
    ...(route.category === undefined ? {} : { category: route.category }),
    ...(route.feedId === undefined ? {} : { feedId: route.feedId }),
    ...(trimmed.length === 0 ? {} : { q: trimmed }),
    beforeId,
  };
}

export function buildSummaryFigures(
  summary: SummaryResponse | undefined,
): Figure[] | undefined {
  if (summary === undefined) return undefined;
  return [
    { label: "Unread", value: summary.views.unread },
    {
      label: "Feeds",
      value: summary.stats.totalFeeds,
      hint: `${String(summary.stats.codeFeeds)} code · ${String(summary.stats.userFeeds)} user`,
    },
    {
      label: "Failing",
      value: summary.stats.failingFeeds,
      severity: summary.stats.failingFeeds > 0 ? "warning" : "ok",
    },
    { label: "Starred", value: summary.views.starred },
  ];
}
