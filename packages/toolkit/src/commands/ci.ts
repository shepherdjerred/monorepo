import { GitHubClient, resolvePrNumber } from "#lib/ci/github.ts";
import { githubToken } from "#lib/ci/process.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { evaluateReadiness, EXIT_CODES } from "#lib/ci/readiness.ts";
import {
  readThroughQuota,
  timeoutResult,
  waitFor,
  waitForCi,
  type LoopResult,
  type WaitResult,
} from "#lib/ci/wait/wait.ts";
import type { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import { watchEvents } from "#lib/ci/events.ts";
import { ciLoad, formatLoad } from "#lib/ci/load.ts";
import { pipelineDiagnostics } from "#lib/ci/diagnostics.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import {
  assertOnMain,
  getMainRun,
  getMainStatus,
  readMainTip,
  type MainRunSnapshot,
} from "#lib/ci/main.ts";
import {
  evaluateFollowedMain,
  evaluateMainRun,
  formatMainWait,
  mainWaitReport,
} from "#lib/ci/wait/main.ts";
import { agentWaitHint } from "#lib/ci/wait/agent-hint.ts";
import type { MainPolicy } from "#lib/ci/readiness.ts";
import { pipelineHistory } from "#lib/ci/history.ts";
import { formatLatency, latencyReport } from "#lib/ci/latency.ts";
import { ciMaintenance } from "#lib/ci/maintenance.ts";
import { latencyEvidence } from "#lib/ci/latency-evidence.ts";
import {
  mainFailure,
  reportCommandError,
  summarizeMain,
  resultReport,
  formatResult,
} from "#lib/ci/output.ts";

export type CiOptions = {
  json: boolean;
  head?: string | undefined;
  timeoutMs?: number | undefined;
  until: "first-failure" | "settled";
  main: boolean;
  /** `wait --main`: follow main's tip until a current tip passes. */
  follow?: boolean | undefined;
  sinceMs?: number | undefined;
};

export async function reportResult(
  result: WaitResult,
  observer: CiObserver,
  json: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const report = await resultReport(result, observer, signal);
  console.log(
    sanitizeText(
      json ? JSON.stringify(report, null, 2) : formatResult(report),
      [observer.github.token, observer.woodpecker.token],
    ),
  );
  process.exitCode = EXIT_CODES[result.verdict.outcome];
}

export function reportRateLimit(
  error: GitHubRateLimitError,
  resumeAt: number,
): void {
  console.error(
    `GitHub rate limit reached; resuming at ${new Date(resumeAt).toISOString()}. This does not mean CI failed. ${error.message}`,
  );
}

/** The PR's current head, read through quota refusals until the deadline. */
function initialPr(
  observer: CiObserver,
  number: number,
  signal: AbortSignal,
  deadline: number | null,
): Promise<Awaited<ReturnType<GitHubClient["pr"]>> | null> {
  return readThroughQuota(
    () => observer.github.pr(number, signal),
    signal,
    deadline,
    reportRateLimit,
  );
}

/** Print the start line and, inside an agent harness, how to hold the wait cheaply. */
export function announceWait(line: string): void {
  console.error(line);
  const hint = agentWaitHint(Bun.env);
  if (hint !== null) console.error(hint);
}

/**
 * Run one cancellable foreground wait. SIGINT and SIGTERM end it with 130 and
 * 143 instead of a CI verdict.
 */
export async function withCancellation(
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const cancellation = { exit: 0 };
  const interrupt = () => {
    cancellation.exit = 130;
    controller.abort();
  };
  const terminate = () => {
    cancellation.exit = 143;
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    await run(controller.signal);
  } catch (error) {
    if (cancellation.exit === 0) throw error;
    process.exitCode = cancellation.exit;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    controller.abort();
  }
}

export type PrWaitOptions = {
  head?: string | undefined;
  timeoutMs?: number | undefined;
  until: "first-failure" | "settled";
  mainPolicy: MainPolicy;
};

/** Pin the PR head and wait until it is ready or actionable. */
export async function waitForPr(
  number: number,
  observer: CiObserver,
  options: PrWaitOptions,
  signal: AbortSignal,
): Promise<WaitResult> {
  const started = Date.now();
  const deadline =
    options.timeoutMs === undefined ? null : started + options.timeoutMs;
  const initial = await initialPr(observer, number, signal, deadline);
  if (initial === null) return timeoutResult(null, started);
  const head = options.head ?? initial.head.sha;
  announceWait(
    `Waiting for PR #${String(number)} @ ${head.slice(0, 12)}. Long queues and builds are expected; keep this process running. Use toolkit ci load for capacity information.`,
  );
  return waitForCi(
    {
      head,
      until: options.until,
      mainPolicy: options.mainPolicy,
      ...(deadline === null
        ? {}
        : { timeoutMs: Math.max(0, deadline - Date.now()) }),
      signal,
    },
    {
      snapshot: (read, force) => observer.snapshot(number, read, force),
      subscribe: (read, wake, connected, fatal) =>
        watchEvents(observer.woodpecker, {
          signal: read,
          wake,
          connected,
          fatal,
          prNumber: number,
        }),
      rateLimited: reportRateLimit,
      heartbeat: (snapshot) => {
        console.error(
          `Still waiting for PR #${String(number)}; pipeline ${snapshot?.pipeline?.status ?? "not created"}. Long waits are expected.`,
        );
      },
    },
  );
}

async function runWait(
  number: number,
  observer: CiObserver,
  options: CiOptions,
): Promise<void> {
  await withCancellation(async (signal) => {
    const result = await waitForPr(
      number,
      observer,
      { ...options, mainPolicy: "report" },
      signal,
    );
    await reportResult(result, observer, options.json, signal);
  });
}

async function reportMainWait(
  result: LoopResult<MainRunSnapshot>,
  observer: CiObserver,
  json: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const report = await mainWaitReport(result, observer, signal);
  console.log(
    sanitizeText(
      json ? JSON.stringify(report, null, 2) : formatMainWait(report),
      [observer.github.token, observer.woodpecker.token],
    ),
  );
  process.exitCode = EXIT_CODES[result.verdict.outcome];
}

/**
 * Wait for main. Pinned (default): one commit's own verifying run passes or
 * fails. `--follow`: re-read main's tip every poll and return only when the
 * current tip passes, so a failed commit waits for the fix that follows it.
 */
async function runMainWait(
  observer: CiObserver,
  options: CiOptions,
): Promise<void> {
  await withCancellation(async (signal) => {
    const started = Date.now();
    const deadline =
      options.timeoutMs === undefined ? null : started + options.timeoutMs;
    const follow = options.follow === true;
    // The pinned commit and its ancestry are GitHub reads too; a quota
    // refusal before the loop starts must wait, not end the command.
    const sha =
      options.head ??
      (await readThroughQuota(
        () => readMainTip(observer.github, signal),
        signal,
        deadline,
        reportRateLimit,
      ));
    const onMain =
      sha === null || follow
        ? sha
        : await readThroughQuota(
            async () => {
              await assertOnMain(observer.github, sha, signal);
              return sha;
            },
            signal,
            deadline,
            reportRateLimit,
          );
    if (sha === null || onMain === null) {
      await reportMainWait(
        timeoutResult<MainRunSnapshot>(null, started),
        observer,
        options.json,
        signal,
      );
      return;
    }
    announceWait(
      follow
        ? `Following main from ${sha.slice(0, 12)} until its current tip passes. Long queues and builds are expected; keep this process running.`
        : `Waiting for main @ ${sha.slice(0, 12)}. Long queues and builds are expected; keep this process running. Use toolkit ci load for capacity information.`,
    );
    const result = await waitFor<MainRunSnapshot>(
      {
        ...(deadline === null
          ? {}
          : { timeoutMs: Math.max(0, deadline - Date.now()) }),
        signal,
      },
      {
        snapshot: async (read) =>
          getMainRun(
            observer.github,
            observer.woodpecker,
            follow ? await readMainTip(observer.github, read) : sha,
            read,
          ),
        evaluate: (snapshot) =>
          Promise.resolve({
            snapshot,
            verdict: follow
              ? evaluateFollowedMain(snapshot)
              : evaluateMainRun(snapshot),
          }),
        subscribe: (read, wake, connected, fatal) =>
          watchEvents(observer.woodpecker, {
            signal: read,
            wake,
            connected,
            fatal,
            prNumber: null,
          }),
        rateLimited: reportRateLimit,
        heartbeat: (snapshot) => {
          console.error(
            `Still waiting for main @ ${(snapshot?.sha ?? sha).slice(0, 12)}; pipeline ${snapshot?.run?.status ?? "not created"}. Long waits are expected.`,
          );
        },
      },
    );
    await reportMainWait(result, observer, options.json, signal);
  });
}

async function showLoad(
  config: Awaited<ReturnType<typeof loadWoodpeckerConfig>>,
  json: boolean,
): Promise<void> {
  const report = await ciLoad(config, AbortSignal.timeout(60_000));
  console.log(
    sanitizeText(json ? JSON.stringify(report, null, 2) : formatLoad(report), [
      config.token,
    ]),
  );
  process.exitCode = [
    report.queue,
    report.admission,
    report.cpu,
    report.memory,
    report.disk,
    report.ioPressure,
    report.pods,
  ].some((section) => !section.available)
    ? 2
    : 0;
}

async function showMain(observer: CiObserver, json: boolean): Promise<void> {
  const main = await getMainStatus(observer.github, observer.woodpecker);
  const secrets = [observer.github.token, observer.woodpecker.token];
  const diagnostics =
    main.state === "red"
      ? await pipelineDiagnostics(
          mainFailure(main),
          observer.woodpecker,
          secrets,
        )
      : [];
  const report = {
    ...summarizeMain(main, observer),
    diagnostics,
    guidance:
      main.state === "red"
        ? "Keep working if main is red; do not try to fix main unless explicitly told."
        : "Pending builds are expected; main's current build is shown separately from its last verdict.",
  };
  const text = [
    `MAIN ${main.state.toUpperCase()} @ ${main.headSha.slice(0, 12)}`,
    ...diagnostics.map(
      (diagnostic) =>
        `${diagnostic.workflow}\n${diagnostic.logs}\n${diagnostic.command}`,
    ),
    report.guidance,
  ].join("\n");
  console.log(
    sanitizeText(json ? JSON.stringify(report, null, 2) : text, secrets),
  );
  process.exitCode = main.state === "red" ? 5 : 0;
}

async function execute(
  action: "wait" | "explain" | "main",
  pr: string | undefined,
  observer: CiObserver,
  options: CiOptions,
): Promise<void> {
  if (action === "wait" && options.main) {
    await runMainWait(observer, options);
    return;
  }
  if (action === "main" || options.main) {
    await showMain(observer, options.json);
    return;
  }
  const number = await resolvePrNumber(pr);
  if (action === "wait") {
    await runWait(number, observer, options);
    return;
  }
  const snapshot = await observer.snapshot(number, undefined, true);
  await reportResult(
    {
      snapshot,
      verdict: evaluateReadiness(
        snapshot,
        options.head ?? snapshot.pr.head.sha,
        options.until,
      ),
      elapsedMs: 0,
    },
    observer,
    options.json,
  );
}

export async function ciCommand(
  action: "wait" | "explain" | "load" | "main" | "timings" | "maintenance",
  pr: string | undefined,
  options: CiOptions,
): Promise<void> {
  const secrets: string[] = [];
  try {
    const config = await loadWoodpeckerConfig();
    secrets.push(config.token);
    if (action === "timings") {
      const until = Date.now() / 1000;
      const since = until - (options.sinceMs ?? 259_200_000) / 1000;
      const pipelines = await pipelineHistory(config, since, until);
      const evidence = await latencyEvidence(pipelines, config);
      const report = latencyReport(pipelines, since, until, evidence);
      console.log(
        sanitizeText(
          options.json
            ? JSON.stringify(report, null, 2)
            : formatLatency(report),
          secrets,
        ),
      );
      return;
    }
    if (action === "maintenance") {
      const report = await ciMaintenance(config);
      console.log(sanitizeText(JSON.stringify(report, null, 2), secrets));
      return;
    }
    if (action === "load") {
      await showLoad(config, options.json);
      return;
    }
    const token = await githubToken();
    secrets.push(token);
    await execute(
      action,
      pr,
      new CiObserver(new GitHubClient(token), config),
      options,
    );
  } catch (error) {
    reportCommandError(error, secrets, options.json);
  }
}
