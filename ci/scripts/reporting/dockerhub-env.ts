import { asRecord } from "../../../scripts/lib/json.ts";

type LoginMode = "publisher" | "reader";
type Environment = Readonly<Record<string, string | undefined>>;
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
  mode: LoginMode,
  environment: Environment,
  execute: LoginExecutor = executeLogin,
): Promise<void> {
  let candidate: unknown;
  if (mode === "reader") {
    try {
      const config: unknown = JSON.parse(
        environment["DOCKERHUB_READ_CONFIG_JSON"] ?? "",
      );
      candidate = asRecord(asRecord(config)?.["auths"])?.[
        "https://index.docker.io/v1/"
      ];
    } catch {
      // JSON diagnostics can contain credential input. Keep it private.
      throw new Error("Docker Hub reader credentials are missing or invalid");
    }
  } else {
    candidate = {
      username: environment["DOCKERHUB_USERNAME"],
      password: environment["DOCKERHUB_PUBLISH_TOKEN"],
    };
  }
  const credentials = asRecord(candidate);
  const username = credentials?.["username"];
  const password = credentials?.["password"];
  if (
    username !== "shepherdjerred" ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    throw new Error(`Docker Hub ${mode} credentials are missing or invalid`);
  }
  const exitCode = await execute(
    [
      "docker",
      "login",
      "docker.io",
      "--username",
      username,
      "--password-stdin",
    ],
    password,
  );
  if (exitCode !== 0) {
    throw new Error(`Docker Hub login exited ${exitCode.toString()}`);
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--reader")) {
    throw new Error("Usage: dockerhub-env.ts [--reader]");
  }
  await dockerHubLogin(
    args[0] === "--reader" ? "reader" : "publisher",
    Bun.env,
  );
}
