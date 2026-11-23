import path from "node:path";
import { stdout } from "node:process";
import { parseArgs } from "node:util";
import { ReplayRenderPackageAdmissionSchema } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { z } from "zod";
import {
  validateReplayComparisonReport,
  verifyPublishedReplayPackage,
} from "./replay-publication/admission-input.ts";
import { readReplayJsonInput } from "./replay-publication/local-json.ts";
import {
  createReplayPublicationClient,
  withReplayPublicationScratch,
} from "./replay-publication/publication-io.ts";
import {
  ScoutReplayStageSchema,
  scoutTarget,
} from "./replay-publication/scout-target.ts";
import { publishReplayObject } from "./replay-publication/storage.ts";

const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const flags = z.object({
  publication: z.string().min(1),
  admission: z.string().min(1),
  report: z.string().min(1),
  stage: ScoutReplayStageSchema,
  apply: z.boolean().default(false),
});

export function parseReplayComparisonArguments(args: readonly string[]) {
  const { values, tokens } = parseArgs({
    args: [...args],
    options: {
      publication: { type: "string" },
      admission: { type: "string" },
      report: { type: "string" },
      stage: { type: "string" },
      apply: { type: "boolean" },
    },
    tokens: true,
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      throw new Error(`--${token.name} may appear only once`);
    seen.add(token.name);
  }
  return flags.parse(values);
}

const dependencies = {
  resolveTarget: scoutTarget,
  createClient: createReplayPublicationClient,
  verify: verifyPublishedReplayPackage,
  publish: publishReplayObject,
};

function requireUniqueReportFields(report: { text: string; value: unknown }) {
  if (report.value === null || typeof report.value !== "object")
    throw new Error("Replay comparison report must be a JSON object");
  // JSON.parse discards duplicates. Count raw property delimiters outside
  // strings after validating the closed, flat metadata schema.
  let fields = 0;
  for (const [token] of report.text.matchAll(/"(?:[^"\\]|\\.)*"|:/gsu)) {
    if (token === ":") fields += 1;
  }
  if (fields !== Object.keys(report.value).length)
    throw new Error("Replay comparison report contains duplicate JSON fields");
}

export async function runReplayComparisonPublication(
  options: z.infer<typeof flags>,
  overrides: Partial<typeof dependencies> = {},
) {
  const deps = { ...dependencies, ...overrides };
  const { bucket, origin } = await deps.resolveTarget(options.stage);
  const { value: publication } = await readReplayJsonInput(
    options.publication,
    "publication",
  );
  const { value: reviewed } = await readReplayJsonInput(
    options.admission,
    "admission",
  );
  const admission = ReplayRenderPackageAdmissionSchema.parse(reviewed);
  const { reportPath, reportSha256 } = admission.nativeComparison;
  const key = `replay-evidence/${reportSha256}/report.json`;
  if (reportPath !== `/${key}`)
    throw new Error(
      "Replay comparison must name its canonical same-origin report path",
    );
  const report = await readReplayJsonInput(
    options.report,
    "comparison report",
    MAX_REPORT_BYTES,
  );
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(report.bytes)
    .digest("hex");
  if (sha256 !== reportSha256)
    throw new Error(
      "Local replay comparison report does not match the reviewed SHA-256",
    );
  const verified = await deps.verify({
    bucket,
    origin,
    stage: options.stage,
    publication,
    admission,
  });
  validateReplayComparisonReport(report.value, admission, verified.protocol, {
    publicSummaryOnly: true,
  });
  requireUniqueReportFields(report);
  if (options.apply) {
    await withReplayPublicationScratch(async (directory) => {
      const filename = path.join(directory, "report.json");
      await Bun.write(filename, report.bytes);
      const client = deps.createClient();
      try {
        await deps.publish({
          client,
          bucket,
          origin,
          object: {
            key,
            path: filename,
            bytes: report.bytes.byteLength,
            sha256,
            contentType: "application/json",
          },
        });
      } finally {
        client.destroy();
      }
    });
  }
  return {
    outcome: options.apply ? "published" : "verified",
    stage: options.stage,
    bucket,
    origin: origin.origin,
    gameBuild: verified.gameBuild,
    protocol: verified.protocol,
    manifestSha256: verified.manifestSha256,
    reportUrl: new URL(reportPath, origin).href,
    reportSha256,
    reportBytes: report.bytes.byteLength,
  };
}

if (import.meta.main) {
  const options = parseReplayComparisonArguments(Bun.argv.slice(2));
  stdout.write(
    `${JSON.stringify(await runReplayComparisonPublication(options), null, 2)}\n`,
  );
}
