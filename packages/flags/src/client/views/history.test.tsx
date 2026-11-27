// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type {
  FlagsArchiveResponse,
  FlagsHistoryResponse,
  FlagsMetadataResponse,
} from "@shepherdjerred/feature-flags/flags-wire.ts";
import {
  mountApp,
  press,
  testTheme,
  typeText,
} from "@shepherdjerred/flags/client/app-harness.test-support.tsx";
import type { DiffViewProps } from "@shepherdjerred/flags/client/code.tsx";
import type { HistoryEntry } from "@shepherdjerred/flags/client/management-api.ts";
import { finalText, relativeTime, restoreCheck } from "./history-model.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// The review dialog's Monaco diff, as its two texts.
vi.mock("@shepherdjerred/flags/client/monaco/diff-view.tsx", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ original, modified }: DiffViewProps) =>
      createElement("output", {
        className: "review-texts",
        "data-original": original,
        "data-modified": modified,
      }),
  };
});

beforeAll(() => {
  // jsdom has no modal dialogs; open and close them through `open`.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    },
  });
});

const theme = testTheme("flags-history-test");
const AUDIT_START = "2026-11-01T00:00:00.000Z";
const concurrency = "delivery-executor-concurrency";

const variant = (key: string, value: string): FlagValue => ({
  type: "variant",
  key,
  value,
});
const boolean = (key: string, on: boolean): FlagValue => ({
  type: "boolean",
  key,
  default: on,
  rollouts: [],
});

const documents: Readonly<
  Record<string, { id: string; revision: number; flags: FlagValue[] }>
> = {
  "scout/prod": {
    id: "scout/prod",
    revision: 7,
    flags: [
      boolean("dares_enabled", true),
      boolean("legacy_flag", false),
      boolean("old_flag", false),
      boolean("older_flag", true),
    ],
  },
  "delivery/prod": {
    id: "delivery/prod",
    revision: 12,
    flags: [variant(concurrency, "8")],
  },
};

type Meta = FlagsMetadataResponse["flags"][number];
const undeclared: Meta = {
  key: "legacy_flag",
  declared: false,
  createdAt: null,
  createdAtBasis: "unknown",
  lastChangedAt: null,
  lastChangedBy: null,
};

const metadata: Readonly<Record<string, FlagsMetadataResponse>> = {
  "scout/prod": {
    deployment: "scout/prod",
    auditStartedAt: AUDIT_START,
    flags: [
      {
        key: "dares_enabled",
        purpose: "Turns on Dares for every guild",
        owner: "scout",
        namespace: "scout-for-lol",
        source: "packages/scout-for-lol",
        declared: true,
        createdAt: "2026-11-20T14:03:00.000Z",
        createdAtBasis: "recorded",
        lastChangedAt: "2026-11-21T09:00:00.000Z",
        lastChangedBy: { kind: "machine", id: "toolkit" },
      },
      undeclared,
      {
        ...undeclared,
        key: "old_flag",
        declared: true,
        createdAt: "2026-09-01T12:00:00.000Z",
        createdAtBasis: "first-declared",
      },
      {
        ...undeclared,
        key: "older_flag",
        declared: true,
        createdAt: "2026-08-25T12:00:00.000Z",
        createdAtBasis: "on-or-before",
      },
    ],
  },
  "delivery/prod": {
    deployment: "delivery/prod",
    auditStartedAt: AUDIT_START,
    flags: [
      {
        ...undeclared,
        key: concurrency,
        purpose: "How many executions Delivery runs at once",
        declared: true,
      },
    ],
  },
};

let nextId = 100;
function entry(
  action: HistoryEntry["action"],
  actor: HistoryEntry["actor"],
  [before, after]: readonly [unknown, unknown],
  revisionAfter = 1,
): HistoryEntry {
  nextId -= 1;
  return {
    id: nextId,
    at: "2026-11-20T10:00:00.000Z",
    action,
    actor,
    revisionAfter,
    before,
    after,
  };
}

const operator = { kind: "human", id: "operator@example.test" } as const;
const toolkit = { kind: "machine", id: "toolkit" } as const;

/** Newest first: the stored value, an older value, then one the registry refuses. */
const concurrencyNewest = [
  entry(
    "update",
    operator,
    [variant(concurrency, "4"), variant(concurrency, "8")],
    11,
  ),
  entry(
    "update",
    toolkit,
    [variant(concurrency, "100"), variant(concurrency, "4")],
    9,
  ),
  entry(
    "update",
    { kind: "machine", id: "unknown" },
    [variant(concurrency, "2"), variant(concurrency, "100")],
    6,
  ),
];
const concurrencyOldest = [
  entry(
    "create",
    { kind: "system", id: "seed" },
    [null, { type: "variant", key: concurrency, value: 5 }],
    2,
  ),
];
const daresHistory = [
  entry(
    "create",
    { kind: "machine", id: "temporal-flag-inventory-sync" },
    [null, boolean("dares_enabled", false)],
    6,
  ),
  entry(
    "update",
    operator,
    [boolean("dares_enabled", true), variant("dares_enabled", "on")],
    5,
  ),
  entry("retire", operator, [boolean("dares_enabled", true), null], 4),
];

function historyPage(path: string): FlagsHistoryResponse {
  const url = new URL(path, "http://flags.test");
  const key = decodeURIComponent(url.pathname.split("/")[6] ?? "");
  const before = url.searchParams.get("before");
  const empty = { entries: [], nextBefore: null, auditStartedAt: AUDIT_START };
  if (key === concurrency) {
    return before === null
      ? {
          ...empty,
          entries: concurrencyNewest,
          nextBefore: concurrencyNewest.at(-1)?.id ?? null,
        }
      : { ...empty, entries: concurrencyOldest };
  }
  if (key === "dares_enabled") return { ...empty, entries: daresHistory };
  if (key === "retired_flag")
    return {
      ...empty,
      entries: [
        entry("retire", operator, [boolean("retired_flag", true), null], 3),
      ],
    };
  return empty;
}

const archive: FlagsArchiveResponse = {
  deployments: [
    {
      id: "scout/prod",
      flags: [
        {
          key: "gone_before_audit",
          retiredAt: null,
          retiredBy: null,
          final: null,
          revision: null,
          basis: "declared-retired",
        },
        {
          key: "retired_flag",
          retiredAt: "2026-11-22T08:30:00.000Z",
          retiredBy: operator,
          final: boolean("retired_flag", true),
          revision: 3,
          basis: "recorded",
        },
      ],
    },
    {
      id: "delivery/prod",
      flags: [
        {
          key: "delivery-old-limit",
          retiredAt: "2026-11-23T08:30:00.000Z",
          retiredBy: toolkit,
          final: variant("delivery-old-limit", "42"),
          revision: 10,
          basis: "recorded",
        },
      ],
    },
  ],
};

function serve(path: string): Response {
  if (path === "/v1/deployments")
    return Response.json({
      deployments: Object.values(documents).map((stored) => ({
        id: stored.id,
        revision: stored.revision,
        flagCount: stored.flags.length,
      })),
    });
  if (path === "/v1/diff") return Response.json({ deployments: [] });
  if (path === "/v1/archive") return Response.json(archive);
  if (path.includes("/history?")) return Response.json(historyPage(path));
  const parts = path.replace("/v1/deployments/", "").split("/");
  const id = parts.slice(0, 2).join("/");
  const view = parts[2];
  const found = view === "metadata" ? metadata[id] : documents[id];
  return found === undefined
    ? Response.json({ error: "unknown deployment" }, { status: 404 })
    : Response.json(found);
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    act(() => {
      root.unmount();
    });
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Serves the fixtures; records every path and each apply body. */
function stubFlags() {
  const paths: string[] = [];
  const applied: unknown[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    paths.push(path);
    if (path.endsWith("/apply")) {
      applied.push(
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      );
      return Response.json({ revision: 13 });
    }
    return serve(path);
  });
  return { paths, applied };
}

async function open(path: string) {
  const { container, root } = await mountApp(path, theme, null);
  roots.push(root);
  const find = (selector: string): Element => {
    const found = container.querySelector(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  const textOf = (selector: string): string[] =>
    [...container.querySelectorAll(selector)].map((node) => node.textContent);
  const buttonNamed = (name: string, within: ParentNode = container) => {
    const found = [
      ...within.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent.trim() === name);
    if (found === undefined) throw new Error(`no button "${name}"`);
    return found;
  };
  const historyEntries = () => [
    ...container.querySelectorAll<HTMLElement>(".fl-history-entry"),
  ];
  return { container, find, textOf, buttonNamed, historyEntries };
}

test("the editor shows the inventory description, its chips and when the flag was added and changed", async () => {
  stubFlags();
  const page = await open("/scout/prod/dares_enabled");
  expect(page.find(".fl-purpose").textContent).toBe(
    "Turns on Dares for every guild",
  );
  expect(page.textOf(".fl-meta-chips .ui-chip")).toEqual([
    "ownerscout",
    "namespacescout-for-lol",
    "sourcepackages/scout-for-lol",
  ]);
  expect(page.container.querySelector(".fl-undeclared")).toBeNull();
  const dates = page.find(".fl-meta-dates").textContent;
  expect(dates).toMatch(
    /^Added 2026-11-20 14:03 UTC · Last changed .+ by toolkit$/u,
  );
});

test("a key missing from the inventory says so, and each added-time basis is worded", async () => {
  stubFlags();
  const page = await open("/scout/prod/legacy_flag");
  expect(page.find(".fl-undeclared").textContent).toBe(
    "Not declared in the inventory",
  );
  expect(page.container.querySelector(".fl-purpose")).toBeNull();
  expect(page.find(".fl-meta-dates").textContent).toBe(
    "Added before audit (2026-11-01 00:00 UTC)",
  );
  // No recorded change means no "Last changed" and an empty timeline.
  expect(page.find(".fl-history").textContent).toContain(
    "No recorded changes since 2026-11-01 00:00 UTC.",
  );

  await press(page.find('a.fl-key[href="/scout/prod/old_flag"]'));
  expect(page.find(".fl-meta-dates").textContent).toBe(
    "Added: first declared 2026-09-01",
  );
  await press(page.find('a.fl-key[href="/scout/prod/older_flag"]'));
  expect(page.find(".fl-meta-dates").textContent).toBe(
    "Added on or before 2026-08-25",
  );
});

test("the table shows descriptions under keys and its search matches them", async () => {
  stubFlags();
  const page = await open("/scout/prod");
  expect(page.find(".fl-desc").textContent).toBe(
    "Turns on Dares for every guild",
  );
  expect(page.find('input[type="search"]').getAttribute("placeholder")).toBe(
    "Filter flags by key or description",
  );
  await typeText(page.find('input[type="search"]'), "every GUILD");
  expect(page.textOf("a.fl-key")).toEqual(["dares_enabled"]);
  expect(page.find(".ui-count").textContent).toBe("1 of 4");
});

test("history lists changes newest first, expands to a diff and loads older pages", async () => {
  const api = stubFlags();
  const page = await open(`/delivery/prod/${concurrency}`);
  const summaries = () =>
    page
      .historyEntries()
      .map((item) => item.querySelector(".fl-history-toggle")?.textContent);
  expect(summaries()).toEqual([
    "Updatedoperator@example.test2026-11-20 10:00 UTCrev 11",
    "Updatedtoolkit2026-11-20 10:00 UTCrev 9",
    "Updatedunknown2026-11-20 10:00 UTCrev 6",
  ]);

  const [first] = page.historyEntries();
  if (first === undefined) throw new Error("no entries");
  const toggle = page.find(".fl-history-toggle");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(first.querySelector(".fl-diff")).toBeNull();
  await press(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const changed = [...first.querySelectorAll(".fl-diff-text[data-sev]")].map(
    (cell) => cell.textContent,
  );
  expect(changed.some((text) => text.includes('"value": "4"'))).toBe(true);
  expect(changed.some((text) => text.includes('"value": "8"'))).toBe(true);

  await press(page.buttonNamed("Load older"));
  expect(api.paths).toContain(
    `/v1/deployments/delivery/prod/flags/${concurrency}/history?limit=20&before=${String(concurrencyNewest.at(-1)?.id)}`,
  );
  expect(summaries().at(-1)).toBe("Createdseed2026-11-20 10:00 UTCrev 2");
  expect(page.container.textContent).not.toContain("Load older");
});

test("restore is offered only for a valid, different version of the same flag", async () => {
  stubFlags();
  const page = await open(`/delivery/prod/${concurrency}`);
  await press(page.buttonNamed("Load older"));
  for (const toggle of page.container.querySelectorAll(".fl-history-toggle"))
    await press(toggle);
  const restores = page.historyEntries().map((item) => {
    const button = page.buttonNamed("Restore this version", item);
    return {
      disabled: button.disabled,
      hint: item.querySelector(".fl-history-restore .ui-muted")?.textContent,
    };
  });
  expect(restores).toEqual([
    { disabled: true, hint: "This version is the stored value." },
    { disabled: false, hint: undefined },
    {
      disabled: true,
      hint: expect.stringContaining(
        "This version fails the value registry today:",
      ) as unknown,
    },
    {
      disabled: true,
      hint: "This version does not match today's flag schema.",
    },
  ]);
});

test("a retirement has no restore, and a version of another type cannot be restored", async () => {
  stubFlags();
  const page = await open("/scout/prod/dares_enabled");
  for (const toggle of page.container.querySelectorAll(".fl-history-toggle"))
    await press(toggle);
  const [created, retyped, retired] = page.historyEntries();
  if (created === undefined || retyped === undefined || retired === undefined)
    throw new Error("missing entries");
  expect(page.buttonNamed("Restore this version", created).disabled).toBe(
    false,
  );
  expect(page.buttonNamed("Restore this version", retyped).title).toBe(
    "This version is a variant flag; the stored flag is a boolean flag.",
  );
  expect(retired.dataset["action"]).toBe("retire");
  expect(retired.querySelector(".fl-history-restore")).toBeNull();
});

test("restore sets the draft, and saving it sends the editor's current revision", async () => {
  const api = stubFlags();
  const page = await open(`/delivery/prod/${concurrency}`);
  const older = page.historyEntries()[1];
  if (older === undefined) throw new Error("no older entry");
  await press(older.querySelector(".fl-history-toggle") ?? older);
  await press(page.buttonNamed("Restore this version", older));
  const input = page.find(".fl-form input");
  expect(input instanceof HTMLInputElement ? input.value : "").toBe("4");
  expect(older.querySelector('[role="status"]')?.textContent).toBe(
    "Loaded into the draft. Review save to write it.",
  );

  await press(page.buttonNamed("Review save"));
  const dialog = page.find("dialog.fl-dialog");
  expect(dialog.hasAttribute("open")).toBe(true);
  const review = page.find(".review-texts");
  if (!(review instanceof HTMLElement)) throw new TypeError("no review");
  expect(review.dataset["original"]).toContain('"value": "8"');
  expect(review.dataset["modified"]).toContain('"value": "4"');

  const historyPath = `/v1/deployments/delivery/prod/flags/${concurrency}/history?limit=20`;
  const historyFetches = () =>
    api.paths.filter((path) => path === historyPath).length;
  const before = historyFetches();
  await press(page.buttonNamed("Save", dialog));
  // The document's revision (12), never the restored entry's (9).
  expect(api.applied).toEqual([
    { expectedRevision: 12, flags: [variant(concurrency, "4")] },
  ]);
  // A save refetches the timeline and the metadata.
  expect(historyFetches()).toBeGreaterThan(before);
  expect(
    api.paths.filter(
      (path) => path === "/v1/deployments/delivery/prod/metadata",
    ).length,
  ).toBeGreaterThan(1);
});

test("the archive lists retired flags read-only, with their history inline", async () => {
  stubFlags();
  const page = await open("/archive");
  expect(page.find("h1").textContent).toBe("Archived");
  expect(document.title).toBe("Archived · Flags");
  expect(
    page.find('a.ui-nav-item[href="/archive"]').getAttribute("aria-current"),
  ).toBe("page");
  expect(
    page.find('a.ui-nav-item[href="/archive"] .ui-nav-count').textContent,
  ).toBe("3");
  expect(page.find(".fl-remedy").textContent).toContain(
    "re-declare the key in managed-flag-inventory.json and remove it from retired-flag-declarations.ts",
  );
  expect(page.textOf(".fl-archive-key")).toEqual([
    "gone_before_audit",
    "retired_flag",
    "delivery-old-limit",
  ]);
  const [unrecorded, recorded, variantRow] = [
    ...page.container.querySelectorAll(".fl-archive-item"),
  ];
  expect(unrecorded?.textContent).toContain(
    "Retired before audit; final value not recorded.",
  );
  expect(recorded?.textContent).toContain(
    "Retired 2026-11-22 08:30 UTC by operator@example.test · rev 3",
  );
  expect(recorded?.querySelector("pre")?.textContent).toContain(
    '"default": true',
  );
  expect(variantRow?.querySelector("pre")?.textContent).toBe("42");

  if (recorded === undefined) throw new Error("no recorded row");
  await press(page.buttonNamed("History", recorded));
  expect(recorded.querySelector(".fl-history-toggle")?.textContent).toContain(
    "Retired",
  );
  // Read-only: nothing to restore, nothing to save.
  expect(page.container.querySelector(".fl-history-restore")).toBeNull();
  expect(page.container.querySelector("form")).toBeNull();
});

test("history helpers", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z");
  expect(relativeTime("2026-11-21T11:59:30.000Z", now)).toBe("just now");
  expect(relativeTime("2026-11-21T09:00:00.000Z", now)).toBe("3 hours ago");
  expect(relativeTime("2026-11-20T11:00:00.000Z", now)).toBe("yesterday");
  // A write after the page measured `now` is not "in 2 minutes".
  expect(relativeTime("2026-11-21T12:02:00.000Z", now)).toBe("just now");
  expect(finalText(variant("json-key-not-managed", "x"))).toBe("x");
  expect(
    restoreCheck(
      entry("update", toolkit, [null, variant("other_key", "1")]),
      variant(concurrency, "8"),
    ),
  ).toEqual({ ok: false, reason: "This version is for key other_key." });
});
