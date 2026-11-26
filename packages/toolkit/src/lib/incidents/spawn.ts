/**
 * Opening a commander session for an incident through `herdr-new-worktree`
 * (packages/dotfiles/bin): a new worktree and agent chat whose first message
 * makes that agent the commander. The dispatch token travels only inside the
 * request, which goes to the spawner through its environment, never argv.
 */
import os from "node:os";
import path from "node:path";
import type { IncidentDetail } from "@shepherdjerred/incidents/contract";

/** `herdr_new_worktree_core.ts` `Request`, field for field. */
export type SpawnRequest = {
  readonly message: string;
  readonly provider: string | null;
  readonly machine: string | null;
  readonly repoMain: string;
  readonly repoTop: string;
  readonly root: string;
  readonly agentArgs: readonly string[];
  readonly safe: boolean;
  readonly launcher: "brim" | "profile";
  readonly argv: readonly string[] | null;
  readonly tab: string | null;
  readonly sendMessage: boolean;
};

export type RepoLocation = {
  readonly repoMain: string;
  readonly repoTop: string;
  readonly root: string;
};

export type SpawnOutcome =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** `token` is passed separately so a spawner can redact it from anything it reports. */
export type Spawner = (
  request: SpawnRequest,
  token: string,
) => Promise<SpawnOutcome>;

/** The variable `herdr-new-worktree --request-env` reads its request from. */
export const SPAWN_REQUEST_VARIABLE = "HERDR_WORKTREE_REQUEST";
export const REDACTED = "[redacted]";

export function redactToken(text: string, token: string): string {
  return token.length === 0 ? text : text.replaceAll(token, REDACTED);
}

function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = result.stdout.toString().trim();
  if (out === "" || result.exitCode !== 0)
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString().trim() || "no output"}`,
    );
  return out;
}

/** Where the new worktree goes: `~/.herdr/worktrees/<repo>`, like the Herdr dialog. */
export function repoLocation(
  cwd: string = process.cwd(),
  home: string = os.homedir(),
): RepoLocation {
  const commonDir = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  const repoMain = path.dirname(commonDir);
  return {
    repoMain,
    repoTop: git(["rev-parse", "--show-toplevel"], cwd),
    root: path.join(home, ".herdr/worktrees", path.basename(repoMain)),
  };
}

/** The first message: everything the new agent needs to take command. */
export function commanderMessage(
  incident: IncidentDetail,
  dispatch: { token: string; leaseExpiresAt: string },
): string {
  const id = incident.identifier;
  const links = incident.links.map(
    (link) =>
      `- ${link.kind} ${link.ref}${link.title === undefined ? "" : ` (${link.title})`}${link.url === undefined ? "" : ` ${link.url}`}`,
  );
  const suspect = incident.suspect;
  const suspectLine =
    suspect === null
      ? []
      : [
          `Suspected cause: ${[
            suspect.prNumber === undefined
              ? null
              : `PR #${String(suspect.prNumber)}`,
            suspect.commitSha === undefined
              ? null
              : `commit ${suspect.commitSha}`,
            suspect.branch === undefined ? null : `branch ${suspect.branch}`,
            suspect.author === undefined ? null : `author ${suspect.author}`,
          ]
            .filter((part) => part !== null)
            .join(", ")}`,
        ];
  return [
    `You are the incident commander for ${id}: ${incident.title}.`,
    `Severity ${incident.severity}, status ${incident.status}. Systems: ${incident.systems.join(", ")}${incident.components.length === 0 ? "" : ` (components: ${incident.components.join(", ")})`}.`,
    `Exit condition: ${incident.exitCondition}`,
    ...(incident.summary === "" ? [] : [`Summary: ${incident.summary}`]),
    ...(incident.impact === null ? [] : [`Impact: ${incident.impact}`]),
    ...suspectLine,
    ...(links.length === 0 ? [] : ["Links:", ...links]),
    `Incident page: ${incident.url}`,
    "",
    `First, claim command. The token is single-use and the lease lapses at ${dispatch.leaseExpiresAt}, after which another agent may be dispatched:`,
    `  toolkit incident claim ${id} --dispatch-token ${dispatch.token}`,
    "",
    "Then load the incident-response skill and work the incident until its exit condition holds.",
    `Other agents are blocked on ${id} and waiting with toolkit incident wait; they resume when it resolves.`,
    `Post milestones with toolkit incident update ${id} --body "<what changed>".`,
    `Resolve with evidence that the exit condition holds: toolkit incident view ${id} for the revision, then toolkit incident resolve ${id} --expected-revision <N> --note "<evidence>".`,
  ].join("\n");
}

export function spawnRequest(
  incident: IncidentDetail,
  dispatch: { token: string; leaseExpiresAt: string; provider: string },
  repo: RepoLocation,
): SpawnRequest {
  return {
    message: commanderMessage(incident, dispatch),
    provider: dispatch.provider,
    machine: null,
    repoMain: repo.repoMain,
    repoTop: repo.repoTop,
    root: repo.root,
    agentArgs: [],
    safe: false,
    launcher: process.platform === "win32" ? "profile" : "brim",
    argv: null,
    tab: `${incident.identifier} commander`,
    sendMessage: true,
  };
}

/** herdr-new-worktree names the branch with one model call and opens the space; give it time. */
const SPAWN_TIMEOUT_MS = 180_000;

function lastLine(text: string): string | null {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.at(-1) ?? null;
}

async function emptyAfter(ms: number): Promise<string> {
  await Bun.sleep(ms);
  return "";
}

/** Output read so far, giving up after a second. */
async function settled(text: Promise<string>): Promise<string> {
  return Promise.race([text, emptyAfter(1000)]);
}

function startSpawner(executable: string, json: string) {
  return Bun.spawn([executable, "--request-env"], {
    env: { ...Bun.env, [SPAWN_REQUEST_VARIABLE]: json },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

/**
 * Run `<executable> --request-env` with the request in its environment and
 * report whether it opened the session (exit 0). Output is redacted of the
 * token before it reaches any message.
 */
export function processSpawner(
  executable: string,
  options: { timeoutMs?: number } = {},
): Spawner {
  return async (request, token) => {
    let child: ReturnType<typeof startSpawner>;
    try {
      child = startSpawner(executable, JSON.stringify(request));
    } catch (error) {
      return {
        ok: false,
        error: `could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const timeoutMs = options.timeoutMs ?? SPAWN_TIMEOUT_MS;
    const run = { timedOut: false };
    const timer = setTimeout(() => {
      run.timedOut = true;
      child.kill();
    }, timeoutMs);
    try {
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      const code = await child.exited;
      // A grandchild can hold the pipes open after the spawner exits; never wait on it.
      const [out, err] = await Promise.all([settled(stdout), settled(stderr)]);
      if (code === 0 && !run.timedOut) return { ok: true };
      const detail = run.timedOut
        ? `timed out after ${String(timeoutMs / 1000)}s`
        : `exited ${String(code)}: ${lastLine(err) ?? lastLine(out) ?? "no output"}`;
      return {
        ok: false,
        error: redactToken(
          `${path.basename(executable)} ${detail}`,
          token,
        ).slice(0, 1000),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
