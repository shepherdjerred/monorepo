import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import {
  HistoryApiBlocksResponseSchema,
  HistoryApiUsageReportResponseSchema,
} from "#lib/history/api/report-schema.ts";
import { usageFixture, type UsageFixture } from "#test/support/usage-index.ts";

/**
 * `toolkit history usage --period` and `toolkit history blocks` run the API's
 * parsers and queries, so their JSON must equal the API response.
 */

let fixture: UsageFixture | undefined;

function current(): UsageFixture {
  if (fixture === undefined) {
    throw new Error("usage fixture is not open");
  }
  return fixture;
}

beforeAll(async () => {
  fixture = await usageFixture([
    {
      source: "claude",
      id: "local",
      events: [
        { at: "2026-11-08T17:00:00.000Z", costUsd: 1.5 },
        { at: "2026-11-10T09:00:00.000Z", model: "claude-haiku-5-5" },
      ],
    },
    {
      source: "claude-mirror",
      id: "desktop/remote",
      machine: "desktop",
      events: [{ at: "2026-11-10T09:30:00.000Z" }],
    },
    {
      source: "codex",
      id: "codex",
      events: [
        { at: "2026-11-11T12:00:00.000Z", model: "gpt-x", costUsd: null },
      ],
    },
  ]);
});

afterAll(async () => {
  await fixture?.close();
});

async function runHistory(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "history", ...args],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...Bun.env, HOME: current().home },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("history usage and blocks CLI", () => {
  test("prints the API's period report for the same query", async () => {
    const cli = await runHistory([
      "usage",
      "--period",
      "week",
      "--breakdown",
      "agent,model",
      "--since",
      "2026-11-01",
      "--timezone",
      "America/Los_Angeles",
      "--json",
    ]);
    expect(cli.exitCode, cli.stderr).toBe(0);
    const cliReport = HistoryApiUsageReportResponseSchema.parse(
      JSON.parse(cli.stdout),
    );
    const api = await current().get(
      "/v1/usage?period=week&breakdown=agent,model&since=2026-11-01&timezone=America/Los_Angeles",
    );
    expect(cliReport).toEqual(api.body);
    expect(cliReport.periods.map((period) => period.period)).toEqual([
      "2026-11-02",
      "2026-11-09",
    ]);
    expect(cliReport.total.unpricedModels).toEqual(["gpt-x"]);

    const human = await runHistory([
      "usage",
      "--period",
      "day",
      "--breakdown",
      "agent",
      "--since",
      "all",
      "--timezone",
      "UTC",
    ]);
    expect(human.exitCode, human.stderr).toBe(0);
    expect(human.stdout).toContain("## Token usage by day (UTC)");
    expect(human.stdout).toMatch(/^Period\s+Agent\s+Input/mu);
    expect(human.stdout).toContain("Unpriced models");
  });

  test("prints blocks and rejects an unknown agent", async () => {
    const cli = await runHistory(["blocks", "--since", "all", "--json"]);
    expect(cli.exitCode, cli.stderr).toBe(0);
    const cliBlocks = HistoryApiBlocksResponseSchema.parse(
      JSON.parse(cli.stdout),
    );
    const apiResponse = await current().get("/v1/blocks?since=all", new Date());
    const api = HistoryApiBlocksResponseSchema.parse(apiResponse.body);
    expect({ ...cliBlocks, now: api.now }).toEqual(api);
    expect(cliBlocks.machine).toBe("local");
    expect(
      cliBlocks.blocks.map((block) => [block.agent, block.start, block.events]),
    ).toEqual([
      ["claude", "2026-11-08T17:00:00.000Z", 1],
      ["claude", "2026-11-10T09:00:00.000Z", 1],
      ["codex", "2026-11-11T12:00:00.000Z", 1],
    ]);

    const all = await runHistory([
      "blocks",
      "--since",
      "all",
      "--machine",
      "all",
      "--agent",
      "claude",
    ]);
    expect(all.exitCode, all.stderr).toBe(0);
    expect(all.stdout).toContain("## 5-hour usage blocks (all machines)");
    expect(all.stdout).toMatch(/^claude\s+\S+ \S+\s+\S+ \S+\s+gap/mu);

    const bad = await runHistory(["blocks", "--agent", "claude-mirror"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('Unknown agent "claude-mirror"');
  });
});
