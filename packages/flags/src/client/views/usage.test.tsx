// @vitest-environment jsdom
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type { FlagsUsageResponse } from "@shepherdjerred/feature-flags/flags-wire.ts";
import {
  deploymentList,
  mountApp,
  testTheme,
  unmountAll,
} from "@shepherdjerred/flags/client/app-harness.test-support.tsx";
import { groupReadSites, livenessText, sourceUrl } from "./usage-panel.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const theme = testTheme("flags-usage-test");
const SINCE = "2026-11-26T10:00:00.000Z";
const lease = "delivery-lease-seconds";
const deliveryConfig = "packages/delivery/src/infrastructure/config.ts";

const variant = (key: string, value: string): FlagValue => ({
  type: "variant",
  key,
  value,
});
const boolean = (key: string): FlagValue => ({
  type: "boolean",
  key,
  default: true,
  rollouts: [],
});

const documents: Readonly<
  Record<string, { id: string; revision: number; flags: FlagValue[] }>
> = {
  "delivery/prod": {
    id: "delivery/prod",
    revision: 4,
    flags: [variant(lease, "120"), variant("delivery-unread", "1")],
  },
  "storm/prod": {
    id: "storm/prod",
    revision: 2,
    flags: [
      boolean("the-storm-crier-enabled"),
      boolean("the-storm-letters-enabled"),
    ],
  },
};

const usage: FlagsUsageResponse = {
  since: SINCE,
  deployments: [
    {
      id: "delivery/prod",
      lastFetchedAt: "2026-11-26T11:55:00.000Z",
      fetches200: 2,
      fetches304: 40,
    },
    { id: "storm/prod", lastFetchedAt: null, fetches200: 0, fetches304: 0 },
  ],
  evaluations: [
    {
      deployment: "storm/prod",
      key: "the-storm-crier-enabled",
      lastEvaluatedAt: "2026-11-26T11:00:00.000Z",
      count: 3,
    },
  ],
  static: {
    version: 1,
    flags: {
      [lease]: [
        {
          package: "@shepherdjerred/delivery",
          file: deliveryConfig,
          kind: "call-argument",
          count: 2,
        },
        {
          package: "@shepherdjerred/delivery",
          file: deliveryConfig,
          kind: "config-flag-name",
          count: 1,
        },
        {
          package: "@shepherdjerred/toolkit",
          file: "packages/toolkit/src/lib/flags/lease.ts",
          kind: "constant",
          count: 1,
        },
        {
          package: "@shepherdjerred/delivery",
          file: "packages/delivery/src/app/lease.ts",
          kind: "array-element",
          count: 1,
        },
      ],
      "the-storm-crier-enabled": [
        {
          package: "the-storm",
          file: "packages/the-storm/src/main/java/Crier.java",
          kind: "java",
          count: 1,
        },
      ],
      "the-storm-letters-enabled": [
        {
          package: "the-storm",
          file: "packages/the-storm/src/main/java/Letters.java",
          kind: "java",
          count: 1,
        },
      ],
    },
    unreferenced: ["delivery-unread"],
  },
};

function serve(path: string): Response {
  if (path === "/v1/deployments") return deploymentList(documents);
  if (path === "/v1/diff") return Response.json({ deployments: [] });
  if (path === "/v1/usage") return Response.json(usage);
  if (path.includes("/history?"))
    return Response.json({
      entries: [],
      nextBefore: null,
      auditStartedAt: SINCE,
    });
  const parts = path.replace("/v1/deployments/", "").split("/");
  const id = parts.slice(0, 2).join("/");
  const found = parts[2] === undefined ? documents[id] : undefined;
  return found === undefined
    ? Response.json({ error: "unknown deployment" }, { status: 404 })
    : Response.json(found);
}

const roots: Root[] = [];

// The fixtures are dated, and the page words them against the current time.
// Pin only `Date`, so promises and React's scheduling still run for real.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  unmountAll(roots);
});

async function open(path: string) {
  vi.stubGlobal("fetch", async (requested: string) => serve(requested));
  const { container, root } = await mountApp(path, theme, null);
  roots.push(root);
  const find = (selector: string): Element => {
    const found = container.querySelector(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  return { container, find };
}

test("Read by groups a key's read sites by package, links each file and names its kinds", async () => {
  const page = await open(`/delivery/prod/${lease}`);
  const panel = page.find(".fl-usage");
  expect(panel.querySelector("h3")?.textContent).toBe("Read by");
  const packages = [...panel.querySelectorAll(".fl-usage-package")].map(
    (node) => node.textContent,
  );
  expect(packages).toEqual([
    "@shepherdjerred/delivery",
    "@shepherdjerred/toolkit",
  ]);
  const files = [...panel.querySelectorAll<HTMLElement>(".fl-usage-file")];
  expect(files.map((row) => row.querySelector("a")?.textContent)).toEqual([
    "packages/delivery/src/app/lease.ts",
    deliveryConfig,
    "packages/toolkit/src/lib/flags/lease.ts",
  ]);
  const config = files[1];
  expect(config?.querySelector("a")?.getAttribute("href")).toBe(
    `https://github.com/shepherdjerred/monorepo/blob/main/${deliveryConfig}`,
  );
  expect(config?.querySelector("a")?.getAttribute("rel")).toBe("noreferrer");
  expect(
    [...(config?.querySelectorAll(".fl-usage-kind") ?? [])].map(
      (node) => node.textContent,
    ),
  ).toEqual(["call-argument ×2", "config-flag-name"]);
  // A TypeScript-read key has no Java evaluation line.
  expect(panel.querySelector(".fl-usage-eval")).toBeNull();
});

test("a key without a read site says no static reference was found, never unused", async () => {
  const page = await open("/delivery/prod/delivery-unread");
  const panel = page.find(".fl-usage");
  expect(page.find(".fl-usage-none").textContent).toBe(
    "No static reference found",
  );
  expect(panel.textContent.toLowerCase()).not.toContain("unused");
});

test("the deployment heading says when a consumer last fetched it, or since when none has", async () => {
  const page = await open("/delivery/prod");
  expect(page.find(".ui-page-lede .fl-liveness").textContent).toMatch(
    /^Last fetched .+ ago$/u,
  );
  expect(page.find(".fl-liveness").getAttribute("title")).toBe(
    "2026-11-26 11:55 UTC · 2 full, 40 not modified since 2026-11-26 10:00 UTC",
  );

  const storm = await open("/storm/prod");
  expect(storm.find(".fl-liveness").textContent).toBe(
    "No consumer fetch since 2026-11-26 10:00 UTC",
  );
});

test("a Java-read key shows its last evaluation, or since when none was seen", async () => {
  const crier = await open("/storm/prod/the-storm-crier-enabled");
  expect(crier.find(".fl-usage-eval").textContent).toMatch(
    /^Last evaluated by the Java client .+ ago$/u,
  );
  const letters = await open("/storm/prod/the-storm-letters-enabled");
  expect(letters.find(".fl-usage-eval").textContent).toBe(
    "No Java client evaluation since 2026-11-26 10:00 UTC",
  );
});

test("overview cards show each deployment's liveness", async () => {
  const page = await open("/");
  expect(
    [...page.container.querySelectorAll(".fl-card-live")].map(
      (node) => node.textContent,
    ),
  ).toEqual([
    expect.stringMatching(/^Last fetched .+ ago$/u),
    "No consumer fetch since 2026-11-26 10:00 UTC",
  ]);
});

test("the helpers group, link and word liveness", () => {
  expect(sourceUrl("packages/a b/c.ts")).toBe(
    "https://github.com/shepherdjerred/monorepo/blob/main/packages/a%20b/c.ts",
  );
  expect(groupReadSites([])).toEqual([]);
  expect(livenessText(usage, "nope/prod", Date.parse(SINCE))).toBeUndefined();
  expect(
    livenessText(usage, "delivery/prod", Date.parse("2026-11-26T12:00:00.000Z"))
      ?.text,
  ).toBe("Last fetched 5 minutes ago");
});
