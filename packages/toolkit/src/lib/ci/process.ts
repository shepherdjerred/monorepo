import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { GUI_DELEGATED_ENVIRONMENT } from "#lib/credential-gui-bridge.ts";
import { lookupExecutable } from "#lib/passthrough.ts";

/** Capture subprocesses without inheriting secret-bearing stdout. */
export async function capture(
  args: readonly string[],
  signal?: AbortSignal,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  signal?.throwIfAborted();
  const child = Bun.spawn([...args], {
    ...(env === undefined ? {} : { env: { ...env } }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => {
    child.kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    signal?.throwIfAborted();
    if (code !== 0) {
      throw new Error(
        `${args[0] ?? "Command"} failed (${String(code)}): ${stderr.trim()}`,
      );
    }
    return stdout;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function captureJson<T>(
  args: readonly string[],
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<T> {
  return schema.parse(JSON.parse(await capture(args, signal, env)));
}

function withoutServiceAccount(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...env };
  delete copy["OP_SERVICE_ACCOUNT_TOKEN"];
  return copy;
}

async function delegateGhAuthToken(
  gh: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  if (env[GUI_DELEGATED_ENVIRONMENT] === "1") {
    return null;
  }
  const home =
    env["HOME"] !== undefined && env["HOME"].length > 0
      ? env["HOME"]
      : os.homedir();
  const herdrCore = path.join(home, ".local", "bin", "herdr-core");
  if (!(await Bun.file(herdrCore).exists())) {
    return null;
  }
  const childEnv = withoutServiceAccount(env);
  try {
    await capture(
      [herdrCore, "server", "status", "--json"],
      AbortSignal.timeout(5000),
      childEnv,
    );
    const raw = await capture(
      [
        herdrCore,
        "exec",
        "--env",
        `${GUI_DELEGATED_ENVIRONMENT}=1`,
        gh,
        "auth",
        "token",
      ],
      AbortSignal.timeout(10_000),
      childEnv,
    );
    const delegated = raw.trim();
    return delegated.length > 0 ? delegated : null;
  } catch {
    return null;
  }
}

export async function tryGithubToken(
  env: Record<string, string | undefined> = Bun.env,
): Promise<string | null> {
  const supplied = env["GH_TOKEN"]?.trim();
  if (supplied !== undefined && supplied.length > 0) {
    return supplied;
  }
  const gh = lookupExecutable("gh", env["PATH"]) ?? "gh";
  try {
    const raw = await capture(
      [gh, "auth", "token"],
      undefined,
      withoutServiceAccount(env),
    );
    const direct = raw.trim();
    if (direct.length > 0) {
      return direct;
    }
  } catch {
    // Fall back to the GUI login session on macOS when Keychain is unreachable.
  }
  return delegateGhAuthToken(gh, env);
}

export async function githubToken(
  env: Record<string, string | undefined> = Bun.env,
): Promise<string> {
  const token = await tryGithubToken(env);
  if (token === null) {
    throw new Error("GitHub credential is empty");
  }
  return token;
}
