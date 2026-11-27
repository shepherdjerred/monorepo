// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type { FlagsDiffResponse } from "@shepherdjerred/feature-flags/flags-wire.ts";
import {
  mountApp,
  settle,
} from "@shepherdjerred/flags/client/app-harness.test-support.tsx";
import { paletteStore } from "@shepherdjerred/flags/client/palette.tsx";
import { DeploymentSidebar } from "@shepherdjerred/flags/client/sidebar.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const noop = (): void => {
  // The theme store's environment never fires events here.
};
const environment: ThemeEnvironment = {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
};
const theme = createThemeStore("flags-views-test", environment);

const bool = (key: string, on: boolean) => ({
  type: "boolean" as const,
  key,
  default: on,
  rollouts: [],
});

const documents: Readonly<
  Record<
    string,
    {
      readonly id: string;
      readonly revision: number;
      readonly flags: readonly FlagValue[];
    }
  >
> = {
  "scout/beta": {
    id: "scout/beta",
    revision: 2,
    flags: [
      bool("dares", true),
      bool("shared", false),
      { type: "variant", key: "budget", value: "500" },
      bool("beta_only", true),
    ],
  },
  "scout/prod": {
    id: "scout/prod",
    revision: 5,
    flags: [
      bool("dares", false),
      bool("shared", false),
      { type: "variant", key: "budget", value: "500" },
      bool("prod_only", false),
    ],
  },
  "golink/prod": {
    id: "golink/prod",
    revision: 9,
    flags: [bool("debug", false)],
  },
};

const diff: FlagsDiffResponse = {
  deployments: [
    {
      id: "golink/prod",
      revision: 9,
      missing: [],
      extra: [],
      drift: [],
      invalid: [],
    },
    {
      id: "scout/prod",
      revision: 5,
      missing: [bool("new_flag", false)],
      extra: ["prod_only"],
      drift: [
        {
          key: "dares",
          live: bool("dares", false),
          declared: bool("dares", true),
        },
      ],
      invalid: [
        {
          key: "budget",
          value: "500",
          issues: [
            { path: "", message: "Too big: expected number to be <=100" },
          ],
        },
      ],
    },
    {
      id: "scout/beta",
      revision: 2,
      missing: [],
      extra: [],
      drift: [],
      invalid: [],
    },
  ],
};

// jsdom does not lay out, so it has no scrollIntoView; record the calls.
const scrolled: Element[] = [];
Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
  scrolled.push(this);
};

const roots: Root[] = [];

afterEach(() => {
  // The palette store is shared, so an earlier test's app must not stay open.
  for (const root of roots.splice(0))
    act(() => {
      root.unmount();
    });
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  scrolled.length = 0;
});

function stubApi(options: { readonly diffStatus?: number } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string): Promise<Response> => {
    calls.push(input);
    if (input === "/v1/deployments") {
      return Response.json({
        deployments: Object.values(documents).map((stored) => ({
          id: stored.id,
          revision: stored.revision,
          flagCount: stored.flags.length,
        })),
      });
    }
    if (input === "/v1/diff") {
      return options.diffStatus === undefined
        ? Response.json(diff)
        : Response.json(
            { error: "internal error" },
            { status: options.diffStatus },
          );
    }
    const id = decodeURIComponent(input.replace("/v1/deployments/", ""));
    const found = documents[id];
    return found === undefined
      ? Response.json({ error: "unknown deployment" }, { status: 404 })
      : Response.json(found);
  });
  return calls;
}

function Probe() {
  const location = useLocation();
  return (
    <output id="probe">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

/** The palette portals into the body, so pages are queried document-wide. */
function query(selector: string): Element {
  const found = document.querySelector(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

function all(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

/** Each summary card's label mapped to its figure. */
function stats(): Record<string, string> {
  return Object.fromEntries(
    all(".ui-summary-card").map((card) => [
      card.querySelector("dt")?.textContent ?? "",
      card.querySelector("dd")?.textContent ?? "",
    ]),
  );
}

/** Each summary card's label mapped to the severity that tints its figure. */
function statSeverities(): Record<string, string | null> {
  return Object.fromEntries(
    all(".ui-summary-card").map((card) => [
      card.querySelector("dt")?.textContent ?? "",
      card instanceof HTMLElement ? (card.dataset["sev"] ?? null) : null,
    ]),
  );
}

async function mount(entry: string) {
  const { container, root } = await mountApp(entry, theme, <Probe />);
  roots.push(root);
  return {
    query,
    all,
    location: () => query("#probe").textContent,
    heading: () => query("h1").textContent,
    text: () => container.textContent,
  };
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await Promise.resolve();
  });
  await settle();
}

async function type(input: Element, value: string): Promise<void> {
  if (!(input instanceof HTMLInputElement)) throw new TypeError("not an input");
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

const rowKeys = (page: Awaited<ReturnType<typeof mount>>): string[] =>
  page.all(".fl-cmp-body tbody a.fl-key").map((link) => link.textContent);

test("the sidebar leads with a Views group and counts drift", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DeploymentSidebar
        ids={["scout/beta", "scout/prod", "golink/prod"]}
        counts={new Map()}
        route={undefined}
        theme={theme}
        view="drift"
        driftCount={4}
      />
    </MemoryRouter>,
  );
  expect(html).toMatch(/>Views<\/p>/);
  expect(html.indexOf(">Views<")).toBeLessThan(html.indexOf(">Deployments<"));
  expect(html).toMatch(/href="\/compare"/);
  const drift = /<a[^>]*href="\/drift"[^>]*>.*?<\/a>/.exec(html)?.[0] ?? "";
  expect(drift).toContain('aria-current="page"');
  expect(drift).toContain('Drift</span><span class="ui-nav-count">4</span>');
  expect(html).toContain('aria-label="Search deployments and flags"');
  expect(html).toContain('aria-label="Flags"');
  // Every row carries an icon.
  const rows = html.match(/<a[^>]*class="ui-nav-item"[^>]*>.*?<\/a>/g) ?? [];
  // Four views (Overview, Compare, Drift, Archived) and three deployments.
  expect(rows).toHaveLength(7);
  for (const row of rows) expect(row).toContain("ui-nav-icon");
});

test("the home page lists catalogs with flag counts and drift", async () => {
  stubApi();
  const page = await mount("/");
  expect(page.heading()).toBe("Deployments");
  expect(stats()).toEqual({
    Deployments: "3",
    Flags: "9",
    "Drifted deployments": "1",
  });
  // Plain counts are untinted; the drift figure takes its worst category.
  expect(statSeverities()).toEqual({
    Deployments: null,
    Flags: null,
    "Drifted deployments": "error",
  });
  const scout = page
    .all(".fl-card")
    .find((card) => card.textContent.startsWith("scout"));
  expect(scout?.textContent).toContain("4 flags · r5");
  expect(scout?.textContent).toContain("4 drift");
  expect(scout?.querySelector(".fl-card-foot")?.getAttribute("href")).toBe(
    "/compare?left=scout%2Fbeta&right=scout%2Fprod",
  );
  expect(page.query('.ui-nav-item[href="/drift"]').textContent).toBe("Drift4");
});

test("compare pairs beta with prod, hides identical flags and keeps state in the URL", async () => {
  stubApi();
  const page = await mount("/compare?left=scout/beta");
  expect(page.heading()).toBe("Compare");
  expect(document.title).toBe("Compare · Flags");
  expect(rowKeys(page)).toEqual(["beta_only", "dares", "prod_only"]);
  expect(stats()).toEqual({
    Differ: "1",
    "Only in Beta": "1",
    "Only in Prod": "1",
    Identical: "2",
  });
  expect(statSeverities()).toEqual({
    Differ: "warning",
    "Only in Beta": "info",
    "Only in Prod": "info",
    Identical: "ok",
  });
  expect(page.query(".fl-cmp-body .ui-count").textContent).toBe("3 of 5");

  // The Show toggle is a radio group: Differences is on, All turns identical flags on.
  const show = page.all(
    '[role="radiogroup"][aria-label="Show"] [role="radio"]',
  );
  expect(show.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
  ]);
  const everything = show[1];
  if (everything === undefined) throw new Error("no All option");
  await click(everything);
  expect(everything.getAttribute("aria-checked")).toBe("true");
  expect(page.location()).toBe("/compare?left=scout%2Fbeta&same=1");
  expect(rowKeys(page)).toEqual([
    "beta_only",
    "budget",
    "dares",
    "prod_only",
    "shared",
  ]);

  await type(page.query('.fl-cmp-body input[type="search"]'), "a");
  expect(page.location()).toBe("/compare?left=scout%2Fbeta&same=1&q=a");
  expect(rowKeys(page)).toEqual(["beta_only", "dares", "shared"]);
});

test("selecting a compared flag shows its diff and links to both editors", async () => {
  stubApi();
  const page = await mount("/compare");
  const dares = page
    .all(".fl-cmp-body a.fl-key")
    .find((link) => link.textContent === "dares");
  if (dares === undefined) throw new Error("no dares row");
  await click(dares);
  expect(page.location()).toBe(
    "/compare?left=scout%2Fbeta&right=scout%2Fprod&key=dares",
  );
  expect(page.query("#compare-flag-heading").textContent).toBe("dares");
  const removed = page
    .all('.fl-diff-text[data-sev="error"]')
    .map((cell) => cell.textContent);
  const added = page
    .all('.fl-diff-text[data-sev="ok"]')
    .map((cell) => cell.textContent);
  expect(removed).toEqual(['−removed:   "default": true,']);
  expect(added).toEqual(['+added:   "default": false,']);
  expect(
    page
      .all(".fl-cmp-detail a.ui-btn")
      .map((link) => link.getAttribute("href")),
  ).toEqual(["/scout/beta/dares", "/scout/prod/dares"]);

  // Changing a side keeps the selection and the other side.
  const right = page.all(".fl-cmp-pick select")[1];
  if (!(right instanceof HTMLSelectElement))
    throw new TypeError("no right select");
  await act(async () => {
    right.value = "golink/prod";
    right.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
  expect(page.location()).toBe(
    "/compare?left=scout%2Fbeta&right=golink%2Fprod&key=dares",
  );
  expect(page.query(".fl-cmp-detail .ui-badge").textContent).toBe(
    "Only in scout/beta",
  );
});

test("a deployment heading links to compare and to its drift", async () => {
  stubApi();
  const page = await mount("/scout/prod");
  expect(page.query(".ui-eyebrow").textContent).toBe("scout");
  expect(page.heading()).toBe("Prod");
  expect(page.query(".fl-revision").textContent).toBe("Revision 5");
  expect(page.query(".ui-page-actions a.ui-btn").getAttribute("href")).toBe(
    "/compare?left=scout%2Fbeta&right=scout%2Fprod",
  );
  expect(page.query(".ui-page-actions a.ui-btn").textContent).toBe(
    "Compare with Beta",
  );
  const chip = page.query(".ui-page-actions .fl-drift-chip");
  expect(chip.getAttribute("href")).toBe("/drift#scout/prod");
  expect(chip.textContent).toBe("4 drift");
});

test("the drift page lists each category with fixes and links", async () => {
  stubApi();
  const page = await mount("/drift#scout/prod");
  expect(page.heading()).toBe("Drift");
  expect(document.title).toBe("Drift · Flags");
  expect(stats()).toEqual({
    Invalid: "1",
    Drift: "1",
    Missing: "1",
    Extra: "1",
  });
  expect(statSeverities()).toEqual({
    Invalid: "error",
    Drift: "warning",
    Missing: "info",
    Extra: "info",
  });
  expect(page.query(".ui-badge-large").textContent).toBe("4 drifted");

  const section = page.query('section[id="scout/prod"]');
  // The #scout/prod hash scrolls its section into view.
  expect(scrolled).toEqual([section]);
  expect(section.textContent).toContain("Too big: expected number to be <=100");
  expect(section.textContent).toContain("new_flag");
  expect(
    [...section.querySelectorAll("a.fl-drift-key")].map((link) =>
      link.getAttribute("href"),
    ),
  ).toEqual([
    "/scout/prod/budget",
    "/scout/prod/dares",
    "/scout/prod/prod_only",
  ]);
  // Drift shows declared against live.
  expect(section.querySelector(".fl-diff thead")?.textContent).toBe(
    "Declared (inventory)Live (Flags)",
  );
  const commands = [...section.querySelectorAll(".fl-command")].map(
    (pre) => pre.textContent,
  );
  expect(commands.join("\n")).toContain(
    "--deployment scout/prod --apply-missing",
  );
  expect(commands.join("\n")).toContain(
    "--plan-declared --deployment scout/prod --flag dares",
  );
  expect(commands.join("\n")).toContain(
    "toolkit flags get scout/prod budget --json",
  );
  // Clean deployments are listed once, together.
  expect(
    page.query('[aria-label="In sync deployments"]').textContent,
  ).toContain("golink/prod");
});

test("a failed drift report says so", async () => {
  stubApi({ diffStatus: 500 });
  const page = await mount("/drift");
  expect(page.query('[role="alert"]').textContent).toBe(
    "The drift report failed: internal error",
  );
});

test("the ⌘K palette finds a flag in any deployment and opens it", async () => {
  const calls = stubApi();
  const page = await mount("/");
  expect(calls.filter((call) => call.startsWith("/v1/deployments/"))).toEqual(
    [],
  );
  await act(async () => {
    paletteStore.setOpen(true);
    await Promise.resolve();
  });
  await settle();
  const search = page.query('input[role="combobox"]');
  await type(search, "beta_on");
  const options = page.all('[role="option"]');
  expect(options.map((option) => option.textContent)).toEqual([
    "beta_onlyscout/beta",
  ]);
  const [option] = options;
  if (option === undefined) throw new Error("no option");
  await click(option);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await settle();
  expect(page.location()).toBe("/scout/beta/beta_only");
  expect(paletteStore.isOpen()).toBe(false);
});

test("the narrow-width top bar's search button opens the palette", async () => {
  stubApi();
  const page = await mount("/");
  expect(paletteStore.isOpen()).toBe(false);
  await click(
    page.query('.ui-topbar button[aria-label="Search deployments and flags"]'),
  );
  expect(paletteStore.isOpen()).toBe(true);
  // Before anything is typed: the views come first.
  expect(
    page
      .all('[role="option"]')
      .slice(0, 3)
      .map((option) => option.textContent),
  ).toEqual(["Overview", "Compare", "Drift"]);
  await act(async () => {
    paletteStore.setOpen(false);
    await Promise.resolve();
  });
});
