import { rm } from "node:fs/promises";
import path from "node:path";
import {
  SandboxDownResponseSchema,
  SandboxSummarySchema,
} from "#protocol/ipc.ts";
import { PlaytestRunResponseSchema } from "#protocol/playtest.ts";
import type { GradeCheck, Grader } from "#evals/lib/types.ts";
import { makeMutants } from "#evals/grade/mutants.ts";

/**
 * E3: rerun the agent's scenario on a fresh `paper` sandbox, then run three
 * mutants that each break one claimed behavior. Pass = the original passes
 * and every mutant fails.
 */
export const playtestGrader: Grader = async (ctx) => {
  const checks: GradeCheck[] = [];
  const notes: string[] = [];
  const scenarioValue = ctx.result?.["scenario"];
  if (typeof scenarioValue !== "string") {
    return {
      checks: [
        {
          name: "result.json names the scenario",
          pass: false,
          detail: JSON.stringify(ctx.result),
        },
      ],
      artifacts: [],
      notes,
    };
  }
  const scenario = path.resolve(ctx.worktree, scenarioValue);
  const file = Bun.file(scenario);
  if (!scenario.startsWith(ctx.worktree) || !(await file.exists())) {
    return {
      checks: [
        {
          name: "scenario file exists in the checkout",
          pass: false,
          detail: scenario,
        },
      ],
      artifacts: [],
      notes,
    };
  }
  checks.push({
    name: "agent reported a passing run",
    pass: ctx.result?.["status"] === "passed",
    detail: String(ctx.result?.["status"]),
  });

  const source = await file.text();
  const mutants = makeMutants(source);
  const base = scenario.replace(/\.playtest\.ts$/u, "");
  const mutantFiles = mutants.map(
    (mutant) => `${base}.mutant-${mutant.name}.playtest.ts`,
  );
  await Promise.all(
    mutants.map(async (mutant, index) => {
      if (mutant.applied) {
        await Bun.write(mutantFiles[index] ?? "", mutant.source);
      }
    }),
  );

  const sandbox = await ctx.daemon.request(
    SandboxSummarySchema,
    "POST",
    "/sandboxes",
    {
      profile: "paper",
      world: "flat",
      ttlSeconds: 3600,
      keep: false,
    },
  );
  const runOne = async (playtest: string): Promise<string> => {
    const run = await ctx.daemon.request(
      PlaytestRunResponseSchema,
      "POST",
      "/playtests",
      {
        files: [playtest],
        target: sandbox.id,
        keep: true,
      },
    );
    return run.reports.map((report) => report.status).join(",") || "no-report";
  };
  try {
    const original = await runOne(scenario);
    checks.push({
      name: "original passes on a fresh sandbox",
      pass: original === "passed",
      detail: original,
    });
    for (const [index, mutant] of mutants.entries()) {
      if (!mutant.applied) {
        checks.push({
          name: `mutant ${mutant.name} is killed`,
          pass: false,
          detail: `could not apply (${mutant.description}); scenario shape not recognized`,
        });
        continue;
      }
      const status = await runOne(mutantFiles[index] ?? "");
      checks.push({
        name: `mutant ${mutant.name} is killed`,
        pass: status === "failed" || status === "errored",
        detail: `${mutant.description} → ${status}`,
      });
    }
  } finally {
    await ctx.daemon.request(
      SandboxDownResponseSchema,
      "DELETE",
      `/sandboxes/${sandbox.id}`,
    );
    await Promise.all(
      mutantFiles.map((mutantFile) => rm(mutantFile, { force: true })),
    );
  }
  return { checks, artifacts: [], notes };
};
