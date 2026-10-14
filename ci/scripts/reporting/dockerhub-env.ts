import { asRecord } from "../../../scripts/lib/json.ts";

type LoginMode = "publisher" | "reader";
type Environment = Readonly<Record<string, string | undefined>>;
type LoginExecutor = (
  command: readonly string[],
  password: string,
) => Promise<number>;

function readerCredentials(value: unknown): unknown {
  const entry = asRecord(value);
  const auth = entry?.["auth"];
  if (auth === undefined) return entry;
  if (
    typeof auth !== "string" ||
    auth.length === 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(auth)
  ) {
    throw new Error("Invalid Docker auth encoding");
  }
  const bytes = Buffer.from(auth, "base64");
  if (bytes.toString("base64") !== auth)
    throw new Error("Noncanonical Docker auth encoding");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const separator = decoded.indexOf(":");
  if (separator === -1) throw new Error("Invalid Docker auth credentials");
  const credentials = {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
  if (
    (entry?.["username"] !== undefined &&
      entry["username"] !== credentials.username) ||
    (entry?.["password"] !== undefined &&
      entry["password"] !== credentials.password)
  ) {
    throw new Error("Conflicting Docker auth credentials");
  }
  return credentials;
}

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
      candidate = readerCredentials(
        asRecord(asRecord(config)?.["auths"])?.["https://index.docker.io/v1/"],
      );
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
