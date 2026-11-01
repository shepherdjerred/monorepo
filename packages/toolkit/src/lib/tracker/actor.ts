import { hostname } from "node:os";
import {
  ActorSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";

export type ActorEnvironment = Readonly<Record<string, string | undefined>>;
export type ActorContext = {
  interactive: boolean;
  name: string;
  cwd: string;
  hostname: string;
  branch?: string;
  worktree?: string;
  repoHead?: string;
  model?: string;
};

function sessionIdentity(
  env: ActorEnvironment,
): { harness: string; session: string } | null {
  const sessions = [
    ["codex", env["CODEX_THREAD_ID"]],
    ["claude-code", env["CLAUDE_CODE_SESSION_ID"]],
    ["cursor", env["CURSOR_CONVERSATION_ID"]],
    ["opencode", env["OPENCODE_SESSION_ID"]],
  ] as const;
  const preferred = env["TRACKER_ACTOR_HARNESS"];
  for (const [harness, session] of sessions) {
    if (preferred !== undefined && preferred !== harness) continue;
    if (session !== undefined && session !== "") return { harness, session };
  }
  if (preferred !== undefined)
    throw new Error(`Missing native session for ${preferred}`);
  return null;
}

/** No process IDs or shared "unknown" sessions: resumed native sessions keep their identity. */
export function detectActor(
  env: ActorEnvironment,
  context: ActorContext,
): ActorEnvelope {
  const explicitKey = env["TRACKER_ACTOR_KEY"];
  const session = sessionIdentity(env);
  const agentPresent =
    session !== null ||
    ["AI_AGENT", "CLAUDECODE", "CODEX_HOME", "CURSOR_AGENT", "OPENCODE"].some(
      (key) => Boolean(env[key]),
    );
  if (
    explicitKey === undefined &&
    session === null &&
    (agentPresent || !context.interactive)
  ) {
    throw new Error(
      "Tracker mutations need a native session ID or TRACKER_ACTOR_KEY and TRACKER_ACTOR_KIND. Install the tracker identity hook for this harness.",
    );
  }
  const key =
    explicitKey ??
    (session === null
      ? `human:${context.name.toLowerCase().replaceAll(/\s+/gu, "-")}`
      : `${session.harness}:${session.session}`);
  const kind =
    env["TRACKER_ACTOR_KIND"] ??
    (explicitKey === undefined
      ? session === null
        ? "human"
        : "agent"
      : undefined);
  if (kind === undefined)
    throw new Error(
      "Set TRACKER_ACTOR_KIND with TRACKER_ACTOR_KEY (human, agent, or runner)",
    );
  return ActorSchema.parse({
    key,
    kind,
    name: env["TRACKER_ACTOR_NAME"] ?? session?.harness ?? context.name,
    metadata: actorMetadata(env, context, session),
  });
}

function actorMetadata(
  env: ActorEnvironment,
  context: ActorContext,
  session: ReturnType<typeof sessionIdentity>,
) {
  return {
    hostname: context.hostname,
    cwd: context.cwd,
    branch: context.branch,
    worktree: context.worktree,
    repoHead: context.repoHead,
    harness: session?.harness,
    sessionId: session?.session,
    harnessVersion: env["AI_AGENT"],
    executable: env["CLAUDE_CODE_EXECPATH"],
    sessionLink: env["CLAUDE_CODE_BRIDGE_SESSION_ID"],
    model: env["TRACKER_ACTOR_MODEL"] ?? context.model,
    hcTerminal: env["HC_TERMINAL_ID"],
    parentKey: env["TRACKER_PARENT_ACTOR_KEY"],
    plan: env["TRACKER_ACTOR_PLAN"],
  };
}

function gitValue(args: string[], cwd: string): string | undefined {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0
    ? result.stdout.toString().trim() || undefined
    : undefined;
}

export function actorContext(name: string): ActorContext {
  const cwd = process.cwd();
  const branch = gitValue(["branch", "--show-current"], cwd);
  const worktree = gitValue(["rev-parse", "--show-toplevel"], cwd);
  const repoHead = gitValue(["rev-parse", "HEAD"], cwd);
  return {
    name,
    cwd,
    hostname: hostname(),
    interactive: process.stdin.isTTY,
    ...(branch === undefined ? {} : { branch }),
    ...(worktree === undefined ? {} : { worktree }),
    ...(repoHead === undefined ? {} : { repoHead }),
  };
}
