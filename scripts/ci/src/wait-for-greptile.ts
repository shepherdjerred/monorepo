type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "startup_failure"
  | "stale"
  | null;

export type GreptileSignal = {
  source: "check-run" | "commit-status";
  name: string;
  status: string;
  conclusion: CheckConclusion;
  url: string | null;
  updatedAt: string | null;
};

type Evaluation =
  | { state: "passed"; message: string }
  | { state: "waiting"; message: string };

const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_INTERVAL_SECONDS = 30;
const GITHUB_API_VERSION = "2022-11-28";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function conclusionField(value: string | null): CheckConclusion {
  switch (value) {
    case "success":
    case "failure":
    case "neutral":
    case "cancelled":
    case "skipped":
    case "timed_out":
    case "action_required":
    case "startup_failure":
    case "stale":
      return value;
    default:
      return null;
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

function repoFromEnvironment(): string {
  const explicit = process.env["GITHUB_REPOSITORY"];
  if (explicit !== undefined && explicit.trim() !== "") {
    return explicit.trim();
  }

  const buildkiteRepo = process.env["BUILDKITE_REPO"];
  if (buildkiteRepo === undefined || buildkiteRepo.trim() === "") {
    return DEFAULT_REPO;
  }

  const sshMatch = buildkiteRepo.match(
    /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u,
  );
  if (sshMatch !== null && sshMatch[1] !== undefined) {
    return sshMatch[1];
  }

  const httpsMatch = buildkiteRepo.match(
    /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u,
  );
  if (httpsMatch !== null && httpsMatch[1] !== undefined) {
    return httpsMatch[1];
  }

  return DEFAULT_REPO;
}

function matchingSignal(signal: GreptileSignal, pattern: RegExp): boolean {
  return pattern.test(signal.name);
}

function signalPassed(signal: GreptileSignal): boolean {
  if (signal.source === "commit-status") {
    return signal.status === "success";
  }
  return signal.status === "completed" && signal.conclusion === "success";
}

function describeSignal(signal: GreptileSignal): string {
  const conclusion =
    signal.conclusion === null ? "" : `, conclusion=${signal.conclusion}`;
  const url = signal.url === null ? "" : `, url=${signal.url}`;
  return `${signal.source} ${signal.name}: status=${signal.status}${conclusion}${url}`;
}

export function evaluateGreptileSignals(
  signals: readonly GreptileSignal[],
  pattern: RegExp = /greptile/iu,
): Evaluation {
  const matching = signals.filter((signal) => matchingSignal(signal, pattern));

  if (matching.length === 0) {
    return {
      state: "waiting",
      message: "No Greptile GitHub status check has been reported yet.",
    };
  }

  const pending = matching.filter((signal) => !signalPassed(signal));
  if (pending.length === 0) {
    return {
      state: "passed",
      message: `Greptile is green: ${matching.map(describeSignal).join("; ")}`,
    };
  }

  return {
    state: "waiting",
    message: `Waiting for Greptile to pass: ${pending.map(describeSignal).join("; ")}`,
  };
}

function latestByName(signals: readonly GreptileSignal[]): GreptileSignal[] {
  const latest = new Map<string, GreptileSignal>();
  for (const signal of signals) {
    const existing = latest.get(signal.name);
    if (existing === undefined) {
      latest.set(signal.name, signal);
      continue;
    }

    const currentTimestamp = Date.parse(signal.updatedAt ?? "");
    const existingTimestamp = Date.parse(existing.updatedAt ?? "");
    if (
      Number.isFinite(currentTimestamp) &&
      (!Number.isFinite(existingTimestamp) ||
        currentTimestamp >= existingTimestamp)
    ) {
      latest.set(signal.name, signal);
    }
  }
  return [...latest.values()];
}

function parseCheckRuns(payload: unknown): GreptileSignal[] {
  if (!isRecord(payload)) {
    throw new Error("GitHub check-runs response was not an object");
  }

  const checkRuns = payload["check_runs"];
  if (!Array.isArray(checkRuns)) {
    throw new Error("GitHub check-runs response did not include check_runs[]");
  }

  const parsed: GreptileSignal[] = [];
  for (const item of checkRuns) {
    if (!isRecord(item)) continue;
    const name = stringField(item, "name");
    const status = stringField(item, "status");
    if (name === null || status === null) continue;
    parsed.push({
      source: "check-run",
      name,
      status,
      conclusion: conclusionField(stringField(item, "conclusion")),
      url: stringField(item, "html_url"),
      updatedAt:
        stringField(item, "completed_at") ??
        stringField(item, "started_at") ??
        stringField(item, "created_at") ??
        (numberField(item, "id") === null
          ? null
          : String(numberField(item, "id"))),
    });
  }
  return latestByName(parsed);
}

function parseCommitStatuses(payload: unknown): GreptileSignal[] {
  if (!isRecord(payload)) {
    throw new Error("GitHub statuses response was not an object");
  }

  const statuses = payload["statuses"];
  if (!Array.isArray(statuses)) {
    throw new Error("GitHub statuses response did not include statuses[]");
  }

  const parsed: GreptileSignal[] = [];
  for (const item of statuses) {
    if (!isRecord(item)) continue;
    const context = stringField(item, "context");
    const state = stringField(item, "state");
    if (context === null || state === null) continue;
    parsed.push({
      source: "commit-status",
      name: context,
      status: state,
      conclusion: state === "success" ? "success" : null,
      url: stringField(item, "target_url"),
      updatedAt:
        stringField(item, "updated_at") ?? stringField(item, "created_at"),
    });
  }
  return latestByName(parsed);
}

async function getJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }

  return await response.json();
}

async function fetchSignals(input: {
  repo: string;
  commit: string;
  token: string;
}): Promise<GreptileSignal[]> {
  const encodedCommit = encodeURIComponent(input.commit);
  const checkRunsUrl = `https://api.github.com/repos/${input.repo}/commits/${encodedCommit}/check-runs?per_page=100`;
  const statusesUrl = `https://api.github.com/repos/${input.repo}/commits/${encodedCommit}/status`;

  const checkRuns = parseCheckRuns(await getJson(checkRunsUrl, input.token));
  const statuses = parseCommitStatuses(await getJson(statusesUrl, input.token));
  return [...checkRuns, ...statuses];
}

async function waitForGreptile(): Promise<void> {
  const pullRequest = process.env["BUILDKITE_PULL_REQUEST"];
  if (
    pullRequest === undefined ||
    pullRequest === "" ||
    pullRequest === "false"
  ) {
    console.log("Not a Buildkite pull request build; skipping Greptile wait.");
    return;
  }

  const token = process.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required to query GitHub check status");
  }

  const commit = process.env["BUILDKITE_COMMIT"];
  if (commit === undefined || commit.trim() === "") {
    throw new Error(
      "BUILDKITE_COMMIT is required to query GitHub check status",
    );
  }

  const pattern = new RegExp(
    process.env["GREPTILE_CHECK_PATTERN"] ?? "greptile",
    "iu",
  );
  const timeoutSeconds = parsePositiveIntegerEnv(
    "GREPTILE_WAIT_TIMEOUT_SECONDS",
    DEFAULT_TIMEOUT_SECONDS,
  );
  const intervalSeconds = parsePositiveIntegerEnv(
    "GREPTILE_WAIT_INTERVAL_SECONDS",
    DEFAULT_INTERVAL_SECONDS,
  );
  const repo = repoFromEnvironment();
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;

  while (Date.now() <= deadline) {
    const signals = await fetchSignals({ repo, commit: commit.trim(), token });
    const evaluation = evaluateGreptileSignals(signals, pattern);
    console.log(evaluation.message);
    if (evaluation.state === "passed") return;
    await Bun.sleep(intervalSeconds * 1000);
  }

  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for Greptile to pass on ${repo}@${commit.trim()}`,
  );
}

if (import.meta.main) {
  try {
    await waitForGreptile();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
