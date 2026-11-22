import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { OpsIngest } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import { systemClock } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { volumeOpsIngest } from "#test-fixtures/ops-snapshot-volume";

const FIXTURE_INGEST_TOKEN = "fixture-ops-ingest-token-with-32-characters";

// `--fixture` swaps the real API for the in-memory fixture server, which needs
// no database, credentials, Grafana or Prometheus. Vite's proxy is unchanged.
const fixture = Bun.argv.includes("--fixture");
if (fixture) {
  Bun.env["OPS_FIXTURE"] ??= "volume";
}
const vitePort = Number(Bun.env["PORT"] ?? "7342");
const apiPort =
  Bun.env["API_PORT"] ??
  (Bun.env["PORT"] === undefined ? "7341" : String(vitePort + 1));
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const baseEnv: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(Bun.env).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value]] : [],
  ),
);
const apiEnv: Record<string, string | undefined> = {
  ...baseEnv,
  PORT: apiPort,
};
const viteEnv: Record<string, string | undefined> = {
  ...baseEnv,
  API_PORT: apiPort,
};

const FixtureKindSchema = z
  .enum(["default", "volume", "volume-aggregate"])
  .default("volume");

function buildSeededIngest(): OpsIngest {
  const generatedAt = systemClock.now().subtract({ minutes: 1 }).toString();
  const kind = FixtureKindSchema.parse(Bun.env["OPS_FIXTURE"]);
  const base =
    kind === "default"
      ? fixtureOpsIngest(generatedAt)
      : volumeOpsIngest(
          generatedAt,
          kind === "volume-aggregate" ? "aggregate" : "per-update",
        );
  return { ...base, facets: FIXTURE_OPS_FACETS };
}

async function pushFixtureFacets(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/internal/v1/ops/snapshots`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${FIXTURE_INGEST_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildSeededIngest()),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const api = Bun.spawn(
  fixture
    ? ["bun", "e2e/server.ts", apiPort]
    : ["bun", "run", "src/server/index.ts"],
  {
    cwd: import.meta.dir.replace(/\/src$/u, ""),
    env: apiEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
);
const vite = Bun.spawn(["vite"], {
  cwd: import.meta.dir.replace(/\/src$/u, ""),
  env: viteEnv,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = { requested: false };
let facetRefreshTimer: ReturnType<typeof setInterval> | undefined;

function isStopped(): boolean {
  return stop.requested;
}

async function seedFixtureWhenReady(): Promise<void> {
  for (let attempt = 0; attempt < 200 && !isStopped(); attempt += 1) {
    if (await pushFixtureFacets()) {
      if (!isStopped()) {
        facetRefreshTimer = setInterval(
          () => void pushFixtureFacets(),
          OPS_POLICY.snapshotIntervalMinutes * 60_000,
        );
      }
      return;
    }
    await Bun.sleep(50);
  }
}

if (fixture) {
  void seedFixtureWhenReady();
}

async function shutdown(): Promise<void> {
  stop.requested = true;
  if (facetRefreshTimer !== undefined) {
    clearInterval(facetRefreshTimer);
  }
  api.kill();
  vite.kill();
  await Promise.all([api.exited, vite.exited]);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
const exitCode = await Promise.race([api.exited, vite.exited]);
// A fixture server that refuses to start (an unknown `OPS_FIXTURE`) fails the
// command instead of ending it quietly.
if (fixture && !stop.requested) {
  process.exitCode = exitCode;
}
await shutdown();
