import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { expectPromtoolRulesPass } from "./promtool-test.ts";
import { getSeaweedfsRuleGroups } from "./seaweedfs.ts";

const METRIC = "SeaweedFS_filer_last_send_timestamp_of_subscribe";
const FILER = `${METRIC}{clientName="filer:10.0.0.1:8888.18888",path="/",sourceFiler="10.0.0.1:8888"}`;
const BACKUP = `${METRIC}{clientName="backup_s3",path="/buckets/",sourceFiler="10.0.0.1:8888"}`;
/** A subscriber that last received an event `ago` seconds before 1.7e9 s. */
const sent = (series: string, ago: number) => ({
  series,
  values: `${String((1_700_000_000 - ago) * 1e9)}+0x4`,
});

test("SeaweedFS backup alerts measure lag against the filer, not the clock", async () => {
  const rules = getSeaweedfsRuleGroups().find(
    (group) => group.name === "seaweedfs-backup",
  )?.rules;
  if (rules === undefined) throw new Error("Missing seaweedfs-backup rules");
  const expressions = Object.fromEntries(
    rules.map((rule) => [rule.alert, rule.expr.value]),
  );
  const cases = [
    {
      name: "caught up",
      input: [sent(FILER, 0), sent(BACKUP, 0)],
      lag: [],
      absent: [],
    },
    {
      name: "a quiet period with no writes is not lag",
      input: [sent(FILER, 86_400), sent(BACKUP, 86_400)],
      lag: [],
      absent: [],
    },
    {
      name: "two hours behind the filer",
      input: [sent(FILER, 0), sent(BACKUP, 7200)],
      lag: [{ labels: "{}", value: 7200 }],
      absent: [],
    },
    {
      name: "no backup subscriber",
      input: [sent(FILER, 0)],
      lag: [],
      absent: [{ labels: '{clientName="backup_s3"}', value: 1 }],
    },
  ];
  const directory = await mkdtemp(path.join(tmpdir(), "seaweedfs-backup-"));
  try {
    const filename = path.join(directory, "tests.json");
    await Bun.write(
      filename,
      JSON.stringify({
        evaluation_interval: "1m",
        tests: cases.map((entry) => ({
          name: entry.name,
          interval: "1m",
          input_series: entry.input,
          promql_expr_test: [
            {
              expr: expressions.SeaweedFSBackupLagging,
              eval_time: "2m",
              exp_samples: entry.lag,
            },
            {
              expr: expressions.SeaweedFSBackupNotRunning,
              eval_time: "2m",
              exp_samples: entry.absent,
            },
          ],
        })),
      }),
    );
    await expectPromtoolRulesPass(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
