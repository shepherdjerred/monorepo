import { GitHubClient, resolvePrNumber } from "#lib/ci/github.ts";
import { githubToken } from "#lib/ci/process.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { evaluateReadiness, EXIT_CODES } from "#lib/ci/readiness.ts";
import { waitForCi, type WaitResult } from "#lib/ci/wait.ts";
import { watchEvents } from "#lib/ci/events.ts";
import { ciLoad, formatLoad } from "#lib/ci/load.ts";
import { pipelineDiagnostics } from "#lib/ci/diagnostics.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import { getMainStatus } from "#lib/ci/main.ts";
import { pipelineHistory } from "#lib/ci/history.ts";
import { formatLatency, latencyReport } from "#lib/ci/latency.ts";
import { ciMaintenance } from "#lib/ci/maintenance.ts";
import { latencyEvidence } from "#lib/ci/latency-evidence.ts";
import {
  mainFailure,
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
  sinceMs?: number | undefined;
};

async function reportResult(
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

async function runWait(
  number: number,
  observer: CiObserver,
  options: CiOptions,
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
    const initial = await observer.github.pr(number, controller.signal);
    const head = options.head ?? initial.head.sha;
    console.error(
      `Waiting for PR #${String(number)} @ ${head.slice(0, 12)}. Long queues and builds are expected; keep this process running. Use toolkit ci load for capacity information.`,
    );
    const result = await waitForCi(
      {
        head,
        until: options.until,
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
        signal: controller.signal,
      },
      {
        snapshot: (signal, force) => observer.snapshot(number, signal, force),
        subscribe: (signal, wake, connected, fatal) =>
          watchEvents(observer.woodpecker, {
            signal,
            wake,
            connected,
            fatal,
            prNumber: number,
          }),
        heartbeat: (snapshot) => {
          console.error(
            `Still waiting for PR #${String(number)}; pipeline ${snapshot?.pipeline?.status ?? "not created"}. Long waits are expected.`,
          );
        },
      },
    );
    await reportResult(result, observer, options.json, controller.signal);
  } catch (error) {
    if (cancellation.exit === 0) throw error;
    process.exitCode = cancellation.exit;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    controller.abort();
  }
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
        ? "Report main's failure and await instructions. Do not repair main."
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
    const message = sanitizeText(
      error instanceof Error ? error.message : String(error),
      secrets,
    );
    if (options.json)
      console.log(
        JSON.stringify({ outcome: "error", ready: false, error: message }),
      );
    else console.error(message);
    process.exitCode = 2;
  }
}
