import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import { evaluateVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
}

const assetsDir = z
  .string()
  .min(1)
  .parse(
    option("--assets-dir") ??
      Bun.env["VOICE_ASSETS_DIR"] ??
      "/opt/streambot/voice",
  );
const reportPath = path.resolve(
  option("--report") ?? "/tmp/streambot-voice-corpus-report.json",
);
const report = await evaluateVoiceCorpus({
  assetsDir,
  runSoak: !Bun.argv.includes("--skip-soak"),
});
await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed)
  throw new Error("Voice corpus acceptance thresholds failed");
