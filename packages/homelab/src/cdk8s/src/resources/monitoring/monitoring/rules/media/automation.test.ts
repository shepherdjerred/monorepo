import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { getMediaRuleGroups } from "./automation.ts";

test("watch alerts distinguish stale evidence from fresh, inactive, and unneeded observations", async () => {
  const expression = getMediaRuleGroups()
    .flatMap((group) => {
      if (group.rules === undefined) throw new Error("Missing media rules");
      return group.rules;
    })
    .find((rule) => rule.alert === "MediaWatchEvidenceStale")?.expr.value;
  if (expression === undefined) throw new Error("Missing media watch alert");
  const labels = '{namespace="media",pod="media-api"}';
  const cases = [
    {
      name: "missing evidence on an active household library",
      timestamp: 0,
      required: 1,
      active: 1,
      expected: [{ labels, value: 1200 }],
    },
    {
      name: "fresh evidence",
      timestamp: 1140,
      required: 1,
      active: 1,
      expected: [],
    },
    {
      name: "observe-only recovery",
      timestamp: 0,
      required: 1,
      active: 0,
      expected: [],
    },
    {
      name: "no non-owner requesters",
      timestamp: 0,
      required: 0,
      active: 1,
      expected: [],
    },
  ];
  const directory = await mkdtemp(path.join(tmpdir(), "media-promql-"));
  try {
    const filename = path.join(directory, "tests.json");
    await Bun.write(
      filename,
      JSON.stringify({
        evaluation_interval: "1m",
        tests: cases.map((entry) => ({
          name: entry.name,
          interval: "1m",
          input_series: [
            {
              series: `media_watch_evidence_oldest_timestamp_seconds${labels}`,
              values: `${String(entry.timestamp)}+0x20`,
            },
            {
              series: `media_watch_evidence_required${labels}`,
              values: `${String(entry.required)}+0x20`,
            },
            {
              series: `media_runtime_active${labels}`,
              values: `${String(entry.active)}+0x20`,
            },
          ],
          promql_expr_test: [
            { expr: expression, eval_time: "20m", exp_samples: entry.expected },
          ],
        })),
      }),
    );
    const process = Bun.spawn(["promtool", "test", "rules", filename], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode, stdout + stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
