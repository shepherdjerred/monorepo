import { dockerHubCredentials } from "../../../scripts/lib/dockerhub-credentials.ts";
import { teeOutputTail } from "./command-output.ts";

type LoginExecutionResult =
  number | { readonly exitCode: number; readonly stderr?: string };

type LoginExecutor = (
  command: readonly string[],
  password: string,
) => Promise<LoginExecutionResult>;

const DOCKERHUB_LOCKOUT_RE = /toomanyrequests|too many failed login attempts/iu;

async function executeLogin(
  command: readonly string[],
  password: string,
): Promise<{ readonly exitCode: number; readonly stderr: string }> {
  const login = Bun.spawn([...command], {
    stdin: new Blob([password]),
    stdout: "inherit",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    teeOutputTail(login.stderr, (chunk) => Bun.stderr.write(chunk)),
    login.exited,
  ]);
  return { exitCode, stderr };
}

/** Authenticate only with the credential explicitly granted to this lane. */
export async function dockerHubLogin(
  mode: "publisher" | "reader",
  environment: Readonly<Record<string, string | undefined>>,
  execute: LoginExecutor = executeLogin,
): Promise<void> {
  const credentials = dockerHubCredentials(mode, environment);
  const result = await execute(
    [
      "docker",
      "login",
      "docker.io",
      "--username",
      credentials.username,
      "--password-stdin",
    ],
    credentials.password,
  );
  const exitCode = typeof result === "number" ? result : result.exitCode;
  const stderr = typeof result === "number" ? "" : (result.stderr ?? "");
  if (exitCode !== 0) {
    if (DOCKERHUB_LOCKOUT_RE.test(stderr)) {
      throw new Error(
        `Docker Hub login failed (exit ${exitCode.toString()}): Docker Hub account lockout or rate limit (toomanyrequests / too many failed login attempts)`,
      );
    }
    throw new Error(`Docker Hub login exited ${exitCode.toString()}`);
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--reader"))
    throw new Error("Usage: dockerhub-env.ts [--reader]");
  await dockerHubLogin(
    args[0] === "--reader" ? "reader" : "publisher",
    Bun.env,
  );
}
