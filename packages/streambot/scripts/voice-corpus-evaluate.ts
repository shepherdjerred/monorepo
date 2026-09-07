import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { atomicWrite } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import { evaluateVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";
import { resolveVoiceWakePhrase } from "@shepherdjerred/streambot/voice/corpus-phrases.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    phrase: { type: "string" },
    "assets-dir": { type: "string" },
    report: { type: "string" },
    "skip-soak": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout
    .write(`Evaluate a wake-phrase corpus against prepared model assets.

Usage:
  bun run voice:corpus:evaluate [--phrase hey-streambot|hey-scout]
    [--assets-dir <dir>] [--report <file>] [--skip-soak]

The assets directory must hold the pinned base model plus the phrase's packaged wake-verifier
assets. Acceptance runs include the 2-hour negative soak; --skip-soak is for iteration only and
records the soak as skipped (which fails the pass gate).
`);
  process.exit(0);
}

const phrase = resolveVoiceWakePhrase(values.phrase);
const assetsDir = z
  .string()
  .min(1)
  .parse(
    values["assets-dir"] ??
      Bun.env["VOICE_ASSETS_DIR"] ??
      phrase.defaultAssetsDir,
  );
const reportPath = path.resolve(
  values.report ?? phrase.defaultCorpusReportPath,
);
const report = await evaluateVoiceCorpus({
  assetsDir,
  phrase,
  runSoak: !values["skip-soak"],
});
await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed)
  throw new Error("Voice corpus acceptance thresholds failed");
