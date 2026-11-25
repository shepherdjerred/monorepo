import { expect, test } from "vitest";
import type { FeedHealthItem } from "@shepherdjerred/feeds/shared/contract.ts";
import {
  draftFromFeed,
  emptyUserFeedDraft,
  entryHostname,
  feedHealthStatus,
  formatAutoReadBadge,
  formatRelativeTime,
  parseRoute,
  parseSearch,
  routeHref,
  routePath,
  searchSuffix,
  toCreateUserFeedBody,
  toUpdateUserFeedBody,
  validateUserFeedDraft,
} from "./model.ts";

test("parses all console routes and query modifiers", () => {
  expect(parseRoute("/")).toEqual({ kind: "entries", view: "unread" });
  expect(parseRoute("/all")).toEqual({ kind: "entries", view: "all" });
  expect(parseRoute("/starred")).toEqual({ kind: "entries", view: "starred" });
  expect(parseRoute("/auto-read")).toEqual({
    kind: "entries",
    view: "auto-read",
  });
  expect(parseRoute("/category/Repo%20Stack")).toEqual({
    kind: "entries",
    view: "unread",
    category: "Repo Stack",
  });
  expect(parseRoute("/category/Blogs", "?view=all&q=rust")).toEqual({
    kind: "entries",
    view: "all",
    category: "Blogs",
  });
  expect(parseRoute("/feed/42")).toEqual({
    kind: "entries",
    view: "all",
    feedId: 42,
  });
  expect(parseRoute("/feeds")).toEqual({ kind: "feeds" });

  expect(parseRoute("/feed/0")).toBeUndefined();
  expect(parseRoute("/feed/not-a-number")).toBeUndefined();
  expect(parseRoute("/unknown")).toBeUndefined();
  expect(parseRoute("/category/a/b")).toBeUndefined();
});

test("builds route paths and preserves ?q= and ?view=all query parameters", () => {
  expect(routePath({ kind: "entries", view: "unread" })).toBe("/");
  expect(
    routePath({
      kind: "entries",
      view: "unread",
      category: "Repo Stack",
    }),
  ).toBe("/category/Repo%20Stack");
  expect(routePath({ kind: "entries", view: "all", feedId: 9 })).toBe(
    "/feed/9",
  );
  expect(routePath({ kind: "feeds" })).toBe("/feeds");

  expect(parseSearch("?q=sqlite+fts5")).toBe("sqlite fts5");
  expect(parseSearch("")).toBe("");

  expect(searchSuffix("  bun  ")).toBe("?q=bun");
  expect(searchSuffix("", "?view=all&q=old")).toBe("?view=all");
  expect(searchSuffix("new", "?view=all&q=old")).toBe("?view=all&q=new");

  expect(
    routeHref(
      { kind: "entries", view: "all", category: "Repo Stack" },
      "release",
    ),
  ).toBe("/category/Repo%20Stack?view=all&q=release");
});

test("computes feed health status severity, hostnames, and relative timestamps", () => {
  expect(
    feedHealthStatus({
      lastStatus: 200,
      consecutiveFailures: 0,
      lastPolledAt: 1000,
    }),
  ).toEqual({ severity: "ok", label: "OK" });
  expect(
    feedHealthStatus({
      lastStatus: 304,
      consecutiveFailures: 0,
      lastPolledAt: 1000,
    }),
  ).toEqual({ severity: "ok", label: "OK" });
  expect(
    feedHealthStatus({
      lastStatus: 502,
      consecutiveFailures: 1,
      lastPolledAt: 1000,
    }),
  ).toEqual({ severity: "warning", label: "Warning" });
  expect(
    feedHealthStatus({
      lastStatus: 500,
      consecutiveFailures: 4,
      lastPolledAt: 1000,
    }),
  ).toEqual({ severity: "error", label: "Critical" });
  expect(
    feedHealthStatus({
      lastStatus: null,
      consecutiveFailures: 0,
      lastPolledAt: null,
    }),
  ).toEqual({ severity: "unknown", label: "Pending" });

  expect(entryHostname("https://www.lwn.net/Articles/999/")).toBe("lwn.net");
  expect(entryHostname("not a url")).toBe("");

  expect(formatRelativeTime(null, 2000)).toBe("Never");
  expect(formatRelativeTime(1980, 2000)).toBe("just now");
  expect(formatRelativeTime(1700, 2000)).toBe("5m ago");
  expect(formatRelativeTime(2000 - 7200, 2000)).toBe("2h ago");

  expect(
    formatAutoReadBadge({
      field: "title",
      pattern: "^ai@",
      flags: "i",
      negate: true,
    }),
  ).toBe("!~ /^ai@/i");
});

test("validates user feed drafts and keeps stored private URLs out of edit drafts", () => {
  const privateFeed: FeedHealthItem = {
    id: 7,
    title: "LWN.net",
    category: "Subscribed",
    source: "user",
    hidden: false,
    displayUrl: "https://lwn.net/headlines/newrss?[REDACTED]",
    htmlUrl: "https://lwn.net",
    description: null,
    autoRead: { field: "title", pattern: "Security", flags: "i" },
    etag: null,
    lastModified: null,
    lastPolledAt: 1_795_576_000,
    lastSuccessAt: 1_795_576_000,
    lastStatus: 200,
    lastError: null,
    consecutiveFailures: 0,
    nextPollAfter: null,
    unreadCount: 4,
  };

  const editDraft = draftFromFeed(privateFeed);
  expect(editDraft.url).toBe("");
  expect(validateUserFeedDraft(editDraft, "edit")).toEqual({});

  const updateWithoutUrl = toUpdateUserFeedBody(editDraft);
  expect(updateWithoutUrl).toEqual({
    title: "LWN.net",
    category: "Subscribed",
    htmlUrl: "https://lwn.net",
    hidden: false,
    autoRead: { field: "title", pattern: "Security", flags: "i" },
  });
  expect("url" in updateWithoutUrl).toBe(false);

  const invalidCreate = {
    ...emptyUserFeedDraft(),
    url: "ftp://bad.example.com",
    category: "   ",
    autoReadPattern: "[unclosed",
  };
  const errors = validateUserFeedDraft(invalidCreate, "create");
  expect(errors.url).toBeDefined();
  expect(errors.category).toBeDefined();
  expect(errors.autoReadPattern).toBeDefined();

  const validCreate = {
    ...emptyUserFeedDraft(),
    url: "https://example.com/atom.xml",
    title: "Example Blog",
    category: "Subscribed",
  };
  expect(validateUserFeedDraft(validCreate, "create")).toEqual({});
  expect(toCreateUserFeedBody(validCreate)).toEqual({
    url: "https://example.com/atom.xml",
    title: "Example Blog",
    category: "Subscribed",
    hidden: false,
    autoRead: null,
  });
});
