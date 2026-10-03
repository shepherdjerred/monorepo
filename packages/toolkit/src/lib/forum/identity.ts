import { createHash } from "node:crypto";

const runners: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  grok: "Grok",
};

export function resolveForumIdentity(
  agent: string,
  explicitSession: string | undefined,
  environment: Record<string, string | undefined> = Bun.env,
) {
  const runner = runners[agent];
  if (runner === undefined) throw new Error(`Unknown forum runner: ${agent}`);
  const sessionId =
    explicitSession ??
    (agent === "codex" ? environment["CODEX_THREAD_ID"] : undefined);
  if (sessionId === undefined)
    throw new Error("--session ID is required (Codex can use CODEX_THREAD_ID)");
  if (!/^[\w.:-]{1,256}$/.test(sessionId))
    throw new Error(
      "Session ID must contain 1–256 letters, digits, dots, underscores, colons or hyphens",
    );
  const digest = createHash("sha256")
    .update(`${agent}\0${sessionId}`)
    .digest("hex");
  return {
    agent,
    sessionId,
    digest,
    username: `${runner}-${digest.slice(0, 16)}`,
  };
}

export type ForumIdentity = ReturnType<typeof resolveForumIdentity>;
