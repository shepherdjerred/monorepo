import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyFreshness,
  assembleSnapshot,
} from "@shepherdjerred/ops-model/assemble.ts";
import { parseSnapshot } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  formatOpsSummary,
  opsSummaryJson,
  parseSectionId,
} from "#commands/ops/ops.ts";
import { fetchOpsSnapshot, opsSnapshotUrl } from "#lib/ops.ts";

const FIXTURE_PATH = path.join(
  import.meta.dirname,
  "fixtures/ops-snapshot.json",
);
const fixtureText = await Bun.file(FIXTURE_PATH).text();
const fixture = parseSnapshot(JSON.parse(fixtureText));
const GENERATED = Date.parse(fixture.generatedAt);
const FRESH_NOW = new Date(GENERATED + 2 * 60_000);
const STALE_NOW = new Date(GENERATED + 60 * 60_000);
const freshFixture = applyFreshness(fixture, FRESH_NOW);
const responseText = JSON.stringify({
  ...freshFixture,
  receivedAt: fixture.generatedAt,
  newSignalIds: [],
});
const staleResponseText = JSON.stringify({
  ...applyFreshness(fixture, STALE_NOW),
  receivedAt: fixture.generatedAt,
  newSignalIds: [],
});

type Route = { status: number; body: string };
let route: Route = { status: 200, body: responseText };
let lastUrl = "";
let server: ReturnType<typeof Bun.serve>;
let home = "";

beforeAll(async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      lastUrl = request.url;
      return new Response(route.body, {
        status: route.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  home = await mkdtemp(path.join(os.tmpdir(), "toolkit-ops-home-"));
});

afterAll(async () => {
  await server.stop(true);
  await rm(home, { recursive: true, force: true });
});

function baseUrl(): string {
  return `http://127.0.0.1:${String(server.port)}`;
}

describe("ops snapshot client", () => {
  test("requests the cursor-free snapshot view and validates the snapshot", async () => {
    route = { status: 200, body: responseText };
    await expect(fetchOpsSnapshot(baseUrl())).resolves.toEqual(freshFixture);
    expect(new URL(lastUrl).pathname).toBe("/api/v1/ops/snapshot");
    expect(new URL(lastUrl).searchParams.has("consumer")).toBe(false);
    expect(opsSnapshotUrl("https://ops.example/")).toBe(
      "https://ops.example/api/v1/ops/snapshot",
    );
  });

  test("a non-200 response is an error carrying the status", async () => {
    route = { status: 503, body: '{"error":"snapshot unavailable"}' };
    await expect(fetchOpsSnapshot(baseUrl())).rejects.toThrow(
      /HTTP 503.*snapshot unavailable/,
    );
  });

  test("a snapshot that breaks the contract is an error", async () => {
    route = { status: 200, body: JSON.stringify({ schemaVersion: 2 }) };
    await expect(fetchOpsSnapshot(baseUrl())).rejects.toThrow(
      /does not match the ops-model contract/,
    );
  });

  test("a network failure is an error naming the URL", async () => {
    await expect(fetchOpsSnapshot("http://127.0.0.1:9")).rejects.toThrow(
      /Could not reach Hub at http:\/\/127\.0\.0\.1:9\//,
    );
  });
});

describe("ops summary rendering", () => {
  test("prints severity, sections, needs-me, and top attention with links", () => {
    const output = formatOpsSummary(applyFreshness(fixture, FRESH_NOW), {
      needsMe: false,
      section: undefined,
    });
    expect(output).toContain(`Ops: ERROR — ${fixture.summary}`);
    expect(output).toContain("(2m ago)");
    expect(output).not.toContain("stale");
    expect(output).toContain("Sources without data: posthog");
    expect(output).toMatch(/ERROR {4}Alerts +1 issue · 1 waiting on you/);
    expect(output).toContain("Needs you (2):");
    expect(output).toContain(
      "Grafana: https://grafana.tailnet-1a49.ts.net/d/pods",
    );
    expect(output).toContain("Top attention (3 of 3):");
    expect(output.indexOf("KubePodCrashLooping")).toBeLessThan(
      output.indexOf("birmel OutOfSync"),
    );
  });

  test("a stale snapshot says so and never renders healthy", () => {
    const stale = applyFreshness(fixture, STALE_NOW);
    const output = formatOpsSummary(stale, {
      needsMe: false,
      section: undefined,
    });
    expect(output).toContain("WARNING: the snapshot is stale");
    expect(output).toContain("(1h 0m ago)");
    expect(output).not.toMatch(/^ {2}ok /mu);
  });

  test("--needs-me and --section select a slice", () => {
    const fresh = applyFreshness(fixture, FRESH_NOW);
    const needsMe = formatOpsSummary(fresh, {
      needsMe: true,
      section: undefined,
    });
    expect(needsMe).toContain("PR #3070 awaiting your review");
    expect(needsMe).not.toContain("birmel OutOfSync");

    const ai = formatOpsSummary(fresh, { needsMe: false, section: "ai" });
    expect(ai).toContain("API spend MTD: $42.50");
    expect(ai).toContain("Max quota used: 62%");
    expect(ai).toContain("Claude Code weekly quota 62%");
    expect(ai).not.toContain("KubePodCrashLooping");

    expect(opsSummaryJson(fresh, { needsMe: false, section: "ai" })).toEqual(
      fixture.sections.find((section) => section.id === "ai"),
    );
    expect(parseSectionId("delivery")).toBe("delivery");
    expect(() => parseSectionId("nope")).toThrow(/Unknown section "nope"/);
  });
});

function volumeSnapshot() {
  const sources = fixture.sources.map((source) => ({ ...source, ok: true }));
  const restore = (index: number) => ({
    id: `restore-${String(index)}`,
    source: "maintenance" as const,
    section: "maintenance" as const,
    kind: "restore-failure",
    severity: "warning" as const,
    needsMe: true,
    title: `Velero restore drill-${String(index)}: PartiallyFailed`,
  });
  const approval = (index: number) => ({
    id: `approval-${String(index)}`,
    source: "renovate" as const,
    section: "delivery" as const,
    kind: "renovate-approval",
    severity: "info" as const,
    needsMe: true,
    title: `chore(deps): update dependency pkg-${String(index)}`,
  });
  const alert = (index: number) => ({
    id: `alert-${String(index)}`,
    source: "alerts" as const,
    section: "alerts" as const,
    kind: "alert",
    severity: "error" as const,
    needsMe: true,
    title: `HostAlert${String(index)}`,
  });
  return applyFreshness(
    assembleSnapshot({
      generatedAt: new Date(GENERATED),
      sources,
      signals: [
        ...Array.from({ length: 10 }, (_, index) => restore(index)),
        ...Array.from({ length: 100 }, (_, index) => approval(index)),
        ...Array.from({ length: 4 }, (_, index) => alert(index)),
        { ...restore(99), severity: "error" as const },
      ],
      metrics: [],
    }),
    FRESH_NOW,
  );
}

describe("ops summary grouping", () => {
  const snapshot = volumeSnapshot();

  test("same-kind signals print as one counted line; alerts stay individual", () => {
    const output = formatOpsSummary(snapshot, {
      needsMe: true,
      section: undefined,
    });
    // The heading counts signals, not lines.
    expect(output).toContain("Needs you (115):");
    expect(output).toContain(
      "  - [WARNING] maintenance: 10 failed Velero restores",
    );
    expect(output).toContain(
      "  - [INFO] delivery: 100 Renovate updates awaiting approval",
    );
    expect(output.match(/HostAlert\d/gu)).toHaveLength(4);
    // A lone restore at another severity is not folded into the group.
    expect(output).toContain(
      "  - [ERROR] maintenance: Velero restore drill-99: PartiallyFailed",
    );
    expect(output).not.toContain("drill-0:");
    expect(output).not.toContain("pkg-0");
    expect(
      output.split("\n").filter((line) => line.startsWith("  - ")),
    ).toHaveLength(7);
  });

  test("top attention caps lines and counts the signals they cover", () => {
    const output = formatOpsSummary(snapshot, {
      needsMe: false,
      section: undefined,
    });
    // 4 alerts, then the lone error restore: 5 lines covering 5 of 15.
    expect(output).toContain("Top attention (5 of 15):");
    const withGroup = formatOpsSummary(
      {
        ...snapshot,
        sections: snapshot.sections.filter(
          (section) => section.id !== "alerts",
        ),
      },
      { needsMe: false, section: undefined },
    );
    // The error restore, then one line for the ten warning restores.
    expect(withGroup).toContain("Top attention (11 of 11):");
  });

  test("a section prints its groups; --json keeps every signal", () => {
    const delivery = formatOpsSummary(snapshot, {
      needsMe: false,
      section: "delivery",
    });
    expect(delivery).toContain("Signals (100):");
    expect(delivery).toContain(
      "  - [INFO] 100 Renovate updates awaiting approval",
    );
    expect(delivery).not.toContain("pkg-1");

    const json = opsSummaryJson(snapshot, {
      needsMe: true,
      section: undefined,
    });
    expect(json).toHaveProperty("signals");
    expect("signals" in json ? json.signals : []).toHaveLength(115);
  });
});

async function runToolkit(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const entrypoint = path.resolve(import.meta.dirname, "../../src/index.ts");
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
    env: { ...Bun.env, HOME: home, OPS_DASHBOARD_URL: baseUrl() },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe("toolkit ops summary subprocess", () => {
  test("prints JSON with freshness applied and exits zero", async () => {
    route = { status: 200, body: staleResponseText };
    const result = await runToolkit(["ops", "summary", "--json"]);
    expect(result.code).toBe(0);
    const printed: unknown = JSON.parse(result.stdout);
    expect(printed).toMatchObject({ schemaVersion: 1, stale: true });
  });

  test("exits nonzero with a clear message on an HTTP error", async () => {
    route = { status: 502, body: "bad gateway" };
    const result = await runToolkit(["ops", "summary"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("toolkit ops: Hub returned HTTP 502");
    expect(result.stdout).toBe("");
  });
});
