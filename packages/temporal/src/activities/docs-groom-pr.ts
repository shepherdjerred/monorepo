import type { GroomTask } from "#shared/docs-groom-types.ts";
import {
  docsGroomFilteredAlreadyOpenTotal,
  docsGroomPrsOpenedTotal,
} from "#observability/metrics.ts";
import {
  parsePrListOutput,
  parsePrNumberFromUrl,
  run,
} from "./docs-groom-utils.ts";
import { REPO, captureWithContext, jsonLog } from "./docs-groom-impl.ts";

const FILTER_RECENT_CLOSED_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type OpenDraftPrInput = {
  branch: string;
  title: string;
  body: string;
  labels: string[];
  kind: "grooming" | "implementation";
};

export async function doFilterAlreadyOpen(
  tasks: GroomTask[],
): Promise<GroomTask[]> {
  const kept: GroomTask[] = [];
  for (const task of tasks) {
    const branch = `docs-groom/${task.slug}`;
    const result = await run(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        REPO,
        "--head",
        branch,
        "--state",
        "all",
        "--json",
        "number,state,closedAt",
        "--limit",
        "10",
      ],
      { throwOnError: false },
    );
    if (result.exitCode !== 0) {
      jsonLog("warning", "gh pr list failed; keeping task", "filter-open", {
        taskSlug: task.slug,
        stderr: result.stderr.slice(0, 300),
      });
      kept.push(task);
      continue;
    }

    const prs = parsePrListOutput(result.stdout);
    const cutoffMs = Date.now() - FILTER_RECENT_CLOSED_DAYS * MS_PER_DAY;
    const blocking = prs.some((pr) => {
      if (pr.state === "OPEN") {
        return true;
      }
      if (pr.closedAt === undefined) {
        return false;
      }
      return new Date(pr.closedAt).getTime() >= cutoffMs;
    });

    if (blocking) {
      docsGroomFilteredAlreadyOpenTotal.inc();
      jsonLog(
        "info",
        "Task already has open or recent PR — dropping",
        "filter-open",
        { taskSlug: task.slug, prCount: prs.length },
      );
    } else {
      kept.push(task);
    }
  }
  return kept;
}

export async function doOpenDraftPr(
  input: OpenDraftPrInput,
): Promise<{ url: string; number: number }> {
  const args = [
    "gh",
    "pr",
    "create",
    "--repo",
    REPO,
    "--draft",
    "--head",
    input.branch,
    "--base",
    "main",
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  for (const label of input.labels) {
    args.push("--label", label);
  }
  const result = await run(args, { throwOnError: false });
  if (result.exitCode !== 0) {
    const e = new Error(
      `gh pr create failed (exit ${String(result.exitCode)}): ${result.stderr}`,
    );
    captureWithContext(e, "pr", {
      branch: input.branch,
      title: input.title,
      kind: input.kind,
    });
    throw e;
  }
  const url = result.stdout.trim();
  const number = parsePrNumberFromUrl(url);
  docsGroomPrsOpenedTotal.inc({ kind: input.kind });
  jsonLog("info", "Opened draft PR", "pr", {
    url,
    number,
    kind: input.kind,
  });
  return { url, number };
}
