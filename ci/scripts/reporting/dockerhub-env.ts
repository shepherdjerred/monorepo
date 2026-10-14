import { dockerHubCredentials } from "../../../scripts/lib/dockerhub-credentials.ts";

type LoginExecutor = (
  command: readonly string[],
  password: string,
) => Promise<number>;
async function executeLogin(
  command: readonly string[],
  password: string,
): Promise<number> {
  const login = Bun.spawn([...command], {
    stdin: new Blob([password]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return login.exited;
}

/** Authenticate only with the credential explicitly granted to this lane. */
export async function dockerHubLogin(
  mode: "publisher" | "reader",
  environment: Readonly<Record<string, string | undefined>>,
  execute: LoginExecutor = executeLogin,
): Promise<void> {
  const credentials = dockerHubCredentials(mode, environment);
  const exitCode = await execute(
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
  if (exitCode !== 0)
    throw new Error(`Docker Hub login exited ${exitCode.toString()}`);
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
