import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { runCorpus } from "#testing/corpus/run.ts";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    output: { type: "string" },
    "regex-executable": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});
if (values.manifest === undefined || values.output === undefined)
  throw new Error(
    "Required: --manifest <explicit local manifest.json> --output <new report.json>; optional --regex-executable <actual packaged matcher>",
  );
const report = await runCorpus(values.manifest, values["regex-executable"]);
await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({ passed: report.passed, counts: report.counts })}\n`,
);
if (!report.passed) process.exitCode = 1;
