import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type StartedProcess = {
  readonly name: string;
  readonly process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  readonly logPath: string;
  readonly logging: Promise<void>;
};

type ProcessOptions = {
  readonly name: string;
  readonly command: string[];
  readonly cwd: string;
  readonly environment: Record<string, string | undefined>;
  readonly artifactDirectory: string;
  readonly secrets: readonly string[];
};

type EnvironmentState = {
  readonly scenarioDirectory: string;
  readonly vaultDirectory: string;
  readonly artifactDirectory: string;
  readonly serverUrl: string;
  readonly proxyUrl: string;
  readonly authToken: string;
  readonly processes: StartedProcess[];
};

export type ScenarioEnvironmentOptions = {
  readonly scenarioId: string;
  readonly seedVault: string;
  readonly tasknotesServerDirectory: string;
  readonly artifactRoot?: string;
  readonly authToken?: string;
  readonly tasksDirectory?: string;
  readonly serverPort?: number;
  readonly proxyPort?: number;
};

export type ChaosFailure = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body?: string;
};

const ChaosStatusSchema = z.object({ offline: z.boolean() });

export class ChaosController {
  public constructor(private readonly baseUrl: string) {}

  public async offline(): Promise<void> {
    await this.control("/__chaos/offline");
  }

  public async online(): Promise<void> {
    await this.control("/__chaos/online");
  }

  public async failNext(failure: ChaosFailure): Promise<void> {
    const response = await fetch(`${this.baseUrl}/__chaos/fail-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(failure),
    });
    if (!response.ok) {
      throw new Error(
        `chaos fail-next control returned ${String(response.status)}`,
      );
    }
  }

  public async status(): Promise<{ readonly offline: boolean }> {
    const response = await fetch(`${this.baseUrl}/__chaos/status`);
    if (!response.ok) {
      throw new Error(`chaos status returned ${String(response.status)}`);
    }
    return ChaosStatusSchema.parse(await response.json());
  }

  private async control(pathname: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `chaos control ${pathname} returned ${String(response.status)}`,
      );
    }
  }
}

export class ScenarioEnvironment {
  public readonly scenarioDirectory: string;
  public readonly vaultDirectory: string;
  public readonly artifactDirectory: string;
  public readonly serverUrl: string;
  public readonly proxyUrl: string;
  public readonly authToken: string;
  public readonly chaos: ChaosController;
  private readonly processes: StartedProcess[];
  private retained = false;

  private constructor(state: EnvironmentState) {
    this.scenarioDirectory = state.scenarioDirectory;
    this.vaultDirectory = state.vaultDirectory;
    this.artifactDirectory = state.artifactDirectory;
    this.serverUrl = state.serverUrl;
    this.proxyUrl = state.proxyUrl;
    this.authToken = state.authToken;
    this.processes = state.processes;
    this.chaos = new ChaosController(state.proxyUrl);
  }

  public static async start(
    options: ScenarioEnvironmentOptions,
  ): Promise<ScenarioEnvironment> {
    validateScenarioId(options.scenarioId);
    const serverPort = options.serverPort ?? (await reservePort());
    const proxyPort = options.proxyPort ?? (await reservePort());
    if (serverPort === proxyPort) {
      throw new Error(
        "the TaskNotes server and chaos proxy need distinct ports",
      );
    }
    const root = options.artifactRoot ?? tmpdir();
    await mkdir(root, { recursive: true });
    const scenarioDirectory = await mkdtemp(
      path.join(root, `tasknotes-e2e-${options.scenarioId}-`),
    );
    const vaultDirectory = path.join(scenarioDirectory, "vault");
    const artifactDirectory = path.join(scenarioDirectory, "artifacts");
    await cp(options.seedVault, vaultDirectory, { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });

    const serverUrl = `http://127.0.0.1:${String(serverPort)}`;
    const proxyUrl = `http://127.0.0.1:${String(proxyPort)}`;
    const authToken = options.authToken ?? crypto.randomUUID();
    const processes: StartedProcess[] = [];
    try {
      processes.push(
        startLoggedProcess({
          name: "tasknotes-server",
          command: ["bun", "run", "src/index.ts"],
          cwd: options.tasknotesServerDirectory,
          environment: {
            ...Bun.env,
            VAULT_PATH: vaultDirectory,
            TASKS_DIR: options.tasksDirectory ?? "TaskNotes",
            AUTH_TOKEN: authToken,
            PORT: String(serverPort),
            SENTRY_ENABLED: "false",
          },
          artifactDirectory,
          secrets: [authToken],
        }),
      );
      await pollUntil("tasknotes-server health", 30_000, async () => {
        try {
          const response = await fetch(`${serverUrl}/api/health`);
          return response.ok;
        } catch {
          return false;
        }
      });

      const proxyScript = fileURLToPath(
        new URL("chaos-proxy.ts", import.meta.url),
      );
      processes.push(
        startLoggedProcess({
          name: "chaos-proxy",
          command: ["bun", proxyScript],
          cwd: scenarioDirectory,
          environment: {
            ...Bun.env,
            CHAOS_PORT: String(proxyPort),
            TARGET_PORT: String(serverPort),
          },
          artifactDirectory,
          secrets: [authToken],
        }),
      );
      const environment = new ScenarioEnvironment({
        scenarioDirectory,
        vaultDirectory,
        artifactDirectory,
        serverUrl,
        proxyUrl,
        authToken,
        processes,
      });
      await pollUntil("chaos proxy", 10_000, async () => {
        try {
          await environment.chaos.status();
          return true;
        } catch {
          return false;
        }
      });
      await environment.writeProcessSnapshot();
      return environment;
    } catch (error) {
      // Report why startup failed, not why cleanup afterwards failed. Letting
      // stopProcesses reject here replaced the real cause with a teardown
      // timeout, which is the harder failure to diagnose.
      try {
        await stopProcesses(processes);
      } catch (cleanupError) {
        if (error instanceof Error && cleanupError instanceof Error) {
          error.cause = cleanupError;
        }
      }
      throw error;
    }
  }

  public retain(): void {
    this.retained = true;
  }

  public async writeDiagnostic(name: string, contents: string): Promise<void> {
    validateArtifactName(name);
    await Bun.write(path.join(this.artifactDirectory, name), contents);
  }

  public async readMarkdownVault(
    tasksDirectory = "TaskNotes",
  ): Promise<ReadonlyMap<string, string>> {
    return readMarkdownVault(this.vaultDirectory, tasksDirectory);
  }

  public async dispose(success: boolean): Promise<void> {
    await this.writeProcessSnapshot();
    await stopProcesses(this.processes);
    if (success && !this.retained) {
      await rm(this.scenarioDirectory, { recursive: true });
    }
  }

  private async writeProcessSnapshot(): Promise<void> {
    const snapshot = this.processes.map((entry) => ({
      name: entry.name,
      pid: entry.process.pid,
      exitCode: entry.process.exitCode,
      log: path.basename(entry.logPath),
    }));
    await this.writeDiagnostic(
      "processes.json",
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
}

export async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("unable to reserve an IPv4 loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error === undefined) {
          resolve(port);
        } else {
          reject(error);
        }
      });
    });
  });
}

export async function pollUntil(
  description: string,
  timeoutMs: number,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${String(timeoutMs)}ms waiting for ${description}`,
      );
    }
    await Bun.sleep(100);
  }
}

export async function readMarkdownVault(
  vaultDirectory: string,
  tasksDirectory = "TaskNotes",
): Promise<ReadonlyMap<string, string>> {
  const directory = path.join(vaultDirectory, tasksDirectory);
  const files = new Map<string, string>();
  for (const entry of await readdir(directory)) {
    if (entry.endsWith(".md")) {
      files.set(entry, await readFile(path.join(directory, entry), "utf8"));
    }
  }
  return files;
}

export async function waitForMarkdown(
  environment: ScenarioEnvironment,
  description: string,
  assertion: (files: ReadonlyMap<string, string>) => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  await pollUntil(description, timeoutMs, async () => {
    try {
      return assertion(await environment.readMarkdownVault());
    } catch {
      return false;
    }
  });
}

function startLoggedProcess(options: ProcessOptions): StartedProcess {
  const logPath = path.join(options.artifactDirectory, `${options.name}.log`);
  const process = Bun.spawn(options.command, {
    cwd: options.cwd,
    env: options.environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const logging = writeProcessLog(
    logPath,
    process.stdout,
    process.stderr,
    options.secrets,
  );
  return { name: options.name, process, logPath, logging };
}

async function writeProcessLog(
  logPath: string,
  standardOutput: ReadableStream<Uint8Array>,
  standardError: ReadableStream<Uint8Array>,
  secrets: readonly string[],
): Promise<void> {
  const writer = Bun.file(logPath).writer();
  const drain = async (prefix: string, stream: ReadableStream<Uint8Array>) => {
    const redactor = new StreamingSecretRedactor(secrets);
    for await (const chunk of stream) {
      const value = redactor.push(chunk);
      if (value.length > 0) {
        await writer.write(`${prefix}${value}`);
      }
    }
    const final = redactor.finish();
    if (final.length > 0) {
      await writer.write(`${prefix}${final}`);
    }
  };
  await Promise.all([
    drain("[stdout] ", standardOutput),
    drain("[stderr] ", standardError),
  ]);
  await writer.end();
}

export class StreamingSecretRedactor {
  private readonly decoder = new TextDecoder();
  private readonly secrets: readonly string[];
  private readonly overlap: number;
  private pending = "";

  public constructor(secrets: readonly string[]) {
    this.secrets = secrets.filter((secret) => secret.length > 0);
    this.overlap = Math.max(
      0,
      ...this.secrets.map((secret) => secret.length - 1),
    );
  }

  public push(chunk: Uint8Array): string {
    this.pending += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  public finish(): string {
    this.pending += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): string {
    const limit = final
      ? this.pending.length
      : this.pending.length - this.overlap;
    if (limit <= 0) {
      return "";
    }
    let cursor = 0;
    let output = "";
    while (cursor < limit) {
      let matchIndex = -1;
      let matchedSecret: string | undefined;
      for (const secret of this.secrets) {
        const index = this.pending.indexOf(secret, cursor);
        if (
          index !== -1 &&
          index < limit &&
          (matchIndex === -1 || index < matchIndex)
        ) {
          matchIndex = index;
          matchedSecret = secret;
        }
      }
      if (matchedSecret === undefined) {
        output += this.pending.slice(cursor, limit);
        cursor = limit;
      } else {
        output += `${this.pending.slice(cursor, matchIndex)}[REDACTED]`;
        cursor = matchIndex + matchedSecret.length;
      }
    }
    this.pending = this.pending.slice(cursor);
    return output;
  }
}

async function stopProcesses(
  processes: readonly StartedProcess[],
): Promise<void> {
  const failures: Error[] = [];
  for (const entry of [...processes].reverse()) {
    try {
      if (entry.process.exitCode === null) {
        entry.process.kill();
      }
      await withTimeout(
        entry.process.exited,
        10_000,
        `${entry.name} process exit`,
      );
      await withTimeout(entry.logging, 10_000, `${entry.name} log drain`);
    } catch (error) {
      // Keep tearing the rest down. Abandoning the loop on the first stubborn
      // process leaks every process that started before it.
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to stop ${String(failures.length)} scenario process(es).`,
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `timed out after ${String(timeoutMs)}ms waiting for ${description}`,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateScenarioId(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new Error(`invalid E2E scenario ID ${JSON.stringify(value)}`);
  }
}

function validateArtifactName(value: string): void {
  if (!/^\w[\w.-]*$/u.test(value)) {
    throw new Error(`invalid E2E artifact name ${JSON.stringify(value)}`);
  }
}
