/**
 * Thin wrapper around the `pinchtab` CLI binary (a persistent, real Chrome
 * instance already running on this machine, controlled via a REST daemon —
 * see the `pinchtab-helper` skill). Toolkit shells out to the CLI itself
 * (same pattern as `lib/github/client.ts`'s `gh` wrapper) rather than
 * reimplementing PinchTab's own auth/config-file resolution: the binary
 * already knows where its token lives.
 *
 * Every call scopes itself to a dedicated agent session (`session create` /
 * `session revoke`) via the `PINCHTAB_SESSION` env var passed to that one
 * subprocess invocation — never mutates the parent toolkit process's own
 * environment, so concurrent/unrelated PinchTab usage on the same machine
 * is unaffected.
 */
import { $ } from "bun";
import { z } from "zod";

export type PinchtabResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

function wrapError(exitCode: number, stderr: string): PinchtabResult<never> {
  const message = stderr.trim();
  return {
    success: false,
    error:
      message.length > 0
        ? message
        : `pinchtab exited with code ${String(exitCode)}`,
  };
}

/**
 * Build the subprocess environment for one pinchtab call. Always starts from a
 * copy of the parent env with any inherited `PINCHTAB_SESSION` removed, then
 * adds this call's own token (if any). This matters because passing
 * `.env(undefined)` would let Bun Shell inherit the parent's env verbatim — so
 * an unscoped admin call (`session create`/`revoke`/`health`) launched from a
 * shell that already has `PINCHTAB_SESSION` set (e.g. another agent's session)
 * would silently run under that foreign session.
 */
function pinchtabEnv(sessionToken: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (key !== "PINCHTAB_SESSION" && value !== undefined) {
      env[key] = value;
    }
  }
  if (sessionToken !== undefined) {
    env["PINCHTAB_SESSION"] = sessionToken;
  }
  return env;
}

async function runJson<T>(
  args: string[],
  schema: z.ZodType<T>,
  sessionToken?: string,
): Promise<PinchtabResult<T>> {
  const result = await $`pinchtab ${args}`
    .nothrow()
    .quiet()
    .env(pinchtabEnv(sessionToken));
  if (result.exitCode !== 0) {
    return wrapError(result.exitCode, result.stderr.toString());
  }
  let json: unknown;
  try {
    json = JSON.parse(result.stdout.toString().trim());
  } catch (error) {
    return {
      success: false,
      error: `pinchtab returned non-JSON output: ${String(error)}`,
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      success: false,
      error: `pinchtab output failed schema validation: ${parsed.error.message}`,
    };
  }
  return { success: true, data: parsed.data };
}

async function runRaw(
  args: string[],
  sessionToken?: string,
): Promise<PinchtabResult<string>> {
  const result = await $`pinchtab ${args}`
    .nothrow()
    .quiet()
    .env(pinchtabEnv(sessionToken));
  if (result.exitCode !== 0) {
    return wrapError(result.exitCode, result.stderr.toString());
  }
  return { success: true, data: result.stdout.toString().trim() };
}

const SessionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  sessionToken: z.string(),
  status: z.string(),
});
export type PinchtabSession = z.infer<typeof SessionSchema>;

const CountSchema = z.object({ selector: z.string(), count: z.number() });

/** `pinchtab health` — quick daemon reachability check. */
export async function health(): Promise<PinchtabResult<string>> {
  return runRaw(["health"]);
}

/** `pinchtab session create --agent-id <agentId>` — mints a scoped session. */
export async function createSession(
  agentId: string,
  label?: string,
): Promise<PinchtabResult<PinchtabSession>> {
  const args = ["session", "create", "--agent-id", agentId, "--json"];
  if (label !== undefined) {
    args.push("--label", label);
  }
  return runJson(args, SessionSchema);
}

/** `pinchtab session revoke <id>` — releases a session created above. */
export async function revokeSession(
  id: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["session", "revoke", id]);
}

/**
 * `pinchtab nav <url> --new-tab --print-tab-id` — navigates in a fresh tab
 * within the given session, returning the new tab's ID.
 */
export async function navigateNewTab(
  sessionToken: string,
  url: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["nav", url, "--new-tab", "--print-tab-id"], sessionToken);
}

/**
 * `pinchtab nav <url> --tab <id>` — navigates an already-open tab. Used to
 * load the real target *after* viewport/media emulation is configured, so the
 * page sees the emulated `prefers-color-scheme` during its first paint/init.
 */
export async function navigateTab(
  sessionToken: string,
  tabId: string,
  url: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["nav", url, "--tab", tabId], sessionToken);
}

/** `pinchtab set viewport <width> <height> --tab <id>`. */
export async function setViewport(
  sessionToken: string,
  tabId: string,
  width: number,
  height: number,
): Promise<PinchtabResult<string>> {
  return runRaw(
    ["set", "viewport", String(width), String(height), "--tab", tabId],
    sessionToken,
  );
}

/** `pinchtab set media <feature> <value> --tab <id>`, e.g. prefers-color-scheme dark. */
export async function setMedia(
  sessionToken: string,
  tabId: string,
  feature: string,
  value: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["set", "media", feature, value, "--tab", tabId], sessionToken);
}

/** `pinchtab count <selector> --tab <id> --json` — used to poll for readiness. */
export async function countSelector(
  sessionToken: string,
  tabId: string,
  selector: string,
): Promise<PinchtabResult<{ selector: string; count: number }>> {
  return runJson(
    ["count", selector, "--tab", tabId, "--json"],
    CountSchema,
    sessionToken,
  );
}

/** `pinchtab screenshot --tab <id> --format png -o <outPath> [--beyond-viewport]`. */
export async function screenshot(
  sessionToken: string,
  tabId: string,
  outPath: string,
  options?: { fullPage?: boolean | undefined },
): Promise<PinchtabResult<string>> {
  const args = ["screenshot", "--tab", tabId, "--format", "png", "-o", outPath];
  if (options?.fullPage === true) {
    args.push("--beyond-viewport");
  }
  return runRaw(args, sessionToken);
}

/** `pinchtab url --tab <id>` — the tab's current URL (after redirects/SPA nav). */
export async function currentUrl(
  sessionToken: string,
  tabId: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["url", "--tab", tabId], sessionToken);
}

/** `pinchtab tab close <id>`. */
export async function closeTab(
  sessionToken: string,
  tabId: string,
): Promise<PinchtabResult<string>> {
  return runRaw(["tab", "close", tabId], sessionToken);
}
