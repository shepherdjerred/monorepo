import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyFreshness } from "@shepherdjerred/ops-model/assemble.ts";
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
      /Could not reach the ops dashboard at http:\/\/127\.0\.0\.1:9\//,
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
    expect(result.stderr).toContain(
      "toolkit ops: Ops dashboard returned HTTP 502",
    );
    expect(result.stdout).toBe("");
  });
});
