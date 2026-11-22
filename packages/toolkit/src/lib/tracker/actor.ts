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

const agentMarkers = [
  "AI_AGENT",
  "AGENT_CLI",
  "AGENT_LAUNCH_ID",
  "ANTIGRAVITY_AGENT",
  "CLAUDECODE",
  "CODEX_HOME",
  "CURSOR_AGENT",
  "GROK_AGENT",
  "KIMI_AGENT",
  "MUSE_AGENT",
  "HC_AGENT_APP",
] as const;

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function normalizedPath(value: string | undefined): string | undefined {
  return value?.replaceAll("\\", "/");
}

function sessionIdentity(
  env: ActorEnvironment,
): { harness: string; session: string } | null {
  const cli = nonEmpty(env["AGENT_CLI"]) ?? nonEmpty(env["AI_AGENT"]);
  const launchId = nonEmpty(env["AGENT_LAUNCH_ID"]);
  const sessions: readonly (readonly [string, string | undefined])[] = [
    ["codex", env["CODEX_THREAD_ID"]],
    ["claude-code", env["CLAUDE_CODE_SESSION_ID"]],
    ["cursor", env["CURSOR_CONVERSATION_ID"]],
    ["grok", env["GROK_SESSION_ID"]],
    [
      "antigravity",
      nonEmpty(env["ANTIGRAVITY_CONVERSATION_ID"]) ??
        nonEmpty(env["ANTIGRAVITY_TRAJECTORY_ID"]),
    ],
    ["kimi", env["KIMI_SESSION_ID"]],
    ["muse", env["MUSE_SESSION_ID"]],
    ...(launchId !== undefined && (cli === "kimi" || cli === "muse")
      ? ([[cli, launchId]] as const)
      : []),
  ];
  const preferred = env["TRACKER_ACTOR_HARNESS"];
  for (const [harness, session] of sessions) {
    if (preferred !== undefined && preferred !== harness) continue;
    if (session !== undefined && session !== "") return { harness, session };
  }
  if (preferred !== undefined)
    throw new Error(`Missing native session for ${preferred}`);
  return null;
}

function isAgentPresent(
  env: ActorEnvironment,
  session: ReturnType<typeof sessionIdentity>,
): boolean {
  return (
    session !== null ||
    agentMarkers.some((key) => Boolean(env[key])) ||
    normalizedPath(env["GIT_CONFIG_GLOBAL"])?.endsWith("/agent/gitconfig") ===
      true ||
    normalizedPath(env["GH_CONFIG_DIR"])?.endsWith("/gh-agent") === true
  );
}

function assertNotHumanInAgentSession(
  agentPresent: boolean,
  key: string | undefined,
  kind: string | undefined,
): void {
  if (
    agentPresent &&
    (kind === "human" || key?.trim().startsWith("human:") === true)
  ) {
    throw new Error("Agent sessions cannot use a human Tracker actor identity");
  }
}

function resolveActorKey(
  explicitKey: string | undefined,
  session: ReturnType<typeof sessionIdentity>,
  context: ActorContext,
): string {
  if (explicitKey !== undefined) return explicitKey;
  return session === null
    ? `human:${context.name.toLowerCase().replaceAll(/\s+/gu, "-")}`
    : `${session.harness}:${session.session}`;
}

function resolveActorKind(
  env: ActorEnvironment,
  explicitKey: string | undefined,
  session: ReturnType<typeof sessionIdentity>,
): string {
  const kind =
    env["TRACKER_ACTOR_KIND"] ??
    (explicitKey === undefined
      ? session === null
        ? "human"
        : "agent"
      : undefined);
  if (kind === undefined) {
    throw new Error(
      "Set TRACKER_ACTOR_KIND with TRACKER_ACTOR_KEY (human, agent, or runner)",
    );
  }
  return kind;
}

/** No process IDs or shared "unknown" sessions: resumed native sessions keep their identity. */
export function detectActor(
  env: ActorEnvironment,
  context: ActorContext,
): ActorEnvelope {
  const explicitKey = env["TRACKER_ACTOR_KEY"];
  const session = sessionIdentity(env);
  const agentPresent = isAgentPresent(env, session);
  assertNotHumanInAgentSession(
    agentPresent,
    explicitKey,
    env["TRACKER_ACTOR_KIND"],
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
  const key = resolveActorKey(explicitKey, session, context);
  const kind = resolveActorKind(env, explicitKey, session);
  assertNotHumanInAgentSession(agentPresent, key, kind);
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
