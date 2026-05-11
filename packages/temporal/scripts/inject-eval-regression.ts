#!/usr/bin/env bun
/**
 * Inject a synthetic regression into a fixture so the next nightly
 * `prReviewEvalWorkflow` run will fire the
 * `PrReviewBotEvalPrecisionRegression` PagerDuty alert. Used to verify
 * the alert wiring end-to-end without waiting for a real regression.
 *
 * The script mutates the LIVE `monorepo-pr-review-fixtures` checkout
 * — by design, since the workflow clones from the upstream remote.
 * Run against a fresh clone of the fixtures repo (the script will
 * verify the cwd is a clone of that repo before touching anything).
 *
 * Steps (`--apply` mode):
 *   1. Read `fixtures/<id>/fixture.json`.
 *   2. Add a fabricated expectedFinding at a line the bot definitely
 *      won't cluster with (line 99999, file "non/existent.ts").
 *   3. Write the mutated fixture.json BACK to the same path.
 *   4. Commit + push a temporary branch (caller-supplied name).
 *   5. Print the resulting commit SHA — bump `EVAL_FIXTURES_PIN` to
 *      this SHA in the monorepo to make the next nightly cron see it.
 *
 * `--dry-run` mode (default): prints what the mutation would be,
 * touches no files.
 *
 * `--revert` mode: undo the mutation. Restores the canonical
 * fixture.json from a `--from-sha` argument.
 *
 * Usage:
 *   bun run packages/temporal/scripts/inject-eval-regression.ts \
 *     --fixtures-repo ~/git/monorepo-pr-review-fixtures \
 *     --fixture-id scout-data-dragon-env-leak \
 *     --dry-run
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { FixtureSchema, type Fixture } from "#shared/pr-review/eval-fixture.ts";

type CliArgs = {
  fixturesRepo: string;
  fixtureId: string;
  apply: boolean;
  revert: boolean;
};

function parseCliArgs(argv: readonly string[]): CliArgs {
  let fixturesRepo = "";
  let fixtureId = "";
  let apply = false;
  let revert = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === undefined) continue;
    switch (flag) {
      case "--fixtures-repo": {
        const value = argv[i + 1];
        if (value === undefined) {
          throw new Error("--fixtures-repo requires a value");
        }
        fixturesRepo = value;
        i++;
        break;
      }
      case "--fixture-id": {
        const value = argv[i + 1];
        if (value === undefined) {
          throw new Error("--fixture-id requires a value");
        }
        fixtureId = value;
        i++;
        break;
      }
      case "--apply": {
        apply = true;
        break;
      }
      case "--revert": {
        revert = true;
        break;
      }
      default: {
        // Unknown flag — ignore. CLI is forgiving by design so a future
        // flag landed in another script doesn't break older scripts.
        break;
      }
    }
  }
  if (fixturesRepo === "" || fixtureId === "") {
    throw new Error(
      "Required: --fixtures-repo <path> --fixture-id <id>. Use --apply to write; default is --dry-run.",
    );
  }
  return { fixturesRepo, fixtureId, apply, revert };
}

function git(repo: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...args], { cwd: repo });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(" ")}: ${stderr.trim()}`));
      }
    });
    child.on("error", reject);
  });
}

async function verifyFixturesRepo(repo: string): Promise<void> {
  const remotes = await git(repo, ["remote", "-v"]);
  if (!remotes.includes("monorepo-pr-review-fixtures")) {
    throw new Error(
      `${repo} does not look like a clone of monorepo-pr-review-fixtures. ` +
        "Refusing to mutate.",
    );
  }
}

function mutate(fixture: Fixture): Fixture {
  return {
    ...fixture,
    expectedFindings: [
      ...fixture.expectedFindings,
      {
        file: "synthetic/regression-injected.ts",
        lineStart: 99_999,
        lineEnd: 99_999,
        kind: "correctness",
        severity: "critical",
        verifier: "none",
        claim:
          "SYNTHETIC: injected by inject-eval-regression.ts. The bot " +
          "cannot possibly emit a finding at this file:line, so this " +
          "appears as FN and tanks the precision/recall numbers. " +
          "Remove this fixture entry once the alert wiring is verified.",
      },
    ],
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  await verifyFixturesRepo(args.fixturesRepo);

  const fixturePath = path.join(
    args.fixturesRepo,
    "fixtures",
    args.fixtureId,
    "fixture.json",
  );
  const raw = await readFile(fixturePath, "utf8");
  const current = FixtureSchema.parse(JSON.parse(raw));

  if (args.revert) {
    // Strip the synthetic finding if present. We identify it by the
    // unique file path the mutate() helper writes.
    const cleaned: Fixture = {
      ...current,
      expectedFindings: current.expectedFindings.filter(
        (f) => f.file !== "synthetic/regression-injected.ts",
      ),
    };
    if (!args.apply) {
      console.warn(
        JSON.stringify({
          msg: "dry-run revert",
          fixtureId: args.fixtureId,
          before: current.expectedFindings.length,
          after: cleaned.expectedFindings.length,
        }),
      );
      return;
    }
    await writeFile(fixturePath, `${JSON.stringify(cleaned, null, 2)}\n`);
    console.warn(
      JSON.stringify({
        msg: "reverted",
        fixtureId: args.fixtureId,
        path: fixturePath,
      }),
    );
    return;
  }

  const mutated = mutate(current);
  if (!args.apply) {
    console.warn(
      JSON.stringify({
        msg: "dry-run inject",
        fixtureId: args.fixtureId,
        expectedFindingsBefore: current.expectedFindings.length,
        expectedFindingsAfter: mutated.expectedFindings.length,
        wouldWriteTo: fixturePath,
      }),
    );
    return;
  }
  await writeFile(fixturePath, `${JSON.stringify(mutated, null, 2)}\n`);
  console.warn(
    JSON.stringify({
      msg: "injected",
      fixtureId: args.fixtureId,
      path: fixturePath,
      next: "Commit + push this change in the fixtures repo, then bump EVAL_FIXTURES_PIN to the new SHA in the monorepo. Run with --revert after the alert fires.",
    }),
  );
}

async function entrypoint(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}

void entrypoint();
