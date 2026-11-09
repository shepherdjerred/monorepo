export type HintEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Agent harnesses differ in how cheaply they can hold a long foreground
 * process. Claude Code notifies on background completion; Codex must poll the
 * running session, and each poll is a full model turn. Name the cheapest
 * pattern at the point of use, where the agent reads it.
 */
export function agentWaitHint(env: HintEnvironment): string | null {
  if (env["CODEX_THREAD_ID"] !== undefined && env["CODEX_THREAD_ID"] !== "")
    return 'Codex: hold this session inside one exec cell with the pragma // @exec: {"yield_time_ms": 3600000}, looping tools.write_stdin({session_id, chars: "", yield_time_ms: 300000}) until it exits. Do not use sleep, re-run status commands, or start another wait.';
  return env["CLAUDECODE"] !== undefined && env["CLAUDECODE"] !== ""
    ? "Claude Code: run this with run_in_background and act on the completion notification. Do not read its output file, sleep, or start another wait meanwhile."
    : null;
}
