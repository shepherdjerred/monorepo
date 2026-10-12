import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  PlaytestListResponseSchema,
  PlaytestReportSchema,
  type PlaytestRunRequest,
  PlaytestRunResponseSchema,
  playtestExitCode,
} from "@shepherdjerred/mc-harness/protocol/playtest.ts";
import { daemonRequest } from "#lib/mc/client.ts";
import { playtestFiles, renderReport, scenarioTemplate } from "#lib/mc/play.ts";

export async function mcPlaytestRunCommand(
  inputs: readonly string[],
  request: Omit<PlaytestRunRequest, "files">,
  json: boolean,
): Promise<void> {
  const files = await playtestFiles(inputs);
  if (!json) {
    console.error(
      `Running ${String(files.length)} playtest file(s)${request.target === undefined ? " on a new sandbox (boot ~20s+)" : ` on ${request.target}`}…`,
    );
  }
  const result = await daemonRequest(
    PlaytestRunResponseSchema,
    "POST",
    "/playtests",
    { ...request, files },
  );
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.reports.map((report) => renderReport(report)).join("\n\n"),
    );
    console.log(
      `\ntarget ${result.target}${result.removedTarget ? " (removed)" : ""}`,
    );
  }
  process.exitCode = playtestExitCode(
    result.reports.map((report) => report.status),
  );
}

export async function mcPlaytestListCommand(json: boolean): Promise<void> {
  const { runs } = await daemonRequest(
    PlaytestListResponseSchema,
    "GET",
    "/playtests",
  );
  if (json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  console.log(
    runs.length === 0
      ? "No playtest runs."
      : runs
          .map(
            (run) =>
              `${run.runId}  ${run.status.padEnd(8)} ${run.scenario}  (${String(Math.round(run.durationMs / 1000))}s)`,
          )
          .join("\n"),
  );
}

export async function mcPlaytestShowCommand(
  runId: string,
  json: boolean,
): Promise<void> {
  const report = await daemonRequest(
    PlaytestReportSchema,
    "GET",
    `/playtests/${encodeURIComponent(runId)}`,
  );
  console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
}

export async function mcPlaytestNewCommand(
  name: string,
  dir: string,
): Promise<void> {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  if (slug.length === 0) {
    throw new Error("name needs at least one letter or digit");
  }
  const file = path.resolve(dir, `${slug}.playtest.ts`);
  if (await Bun.file(file).exists()) {
    throw new Error(`${file} already exists`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, scenarioTemplate(name));
  console.log(`wrote ${file}`);
}
