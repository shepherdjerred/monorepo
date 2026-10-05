import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import { z } from "zod";
import path from "node:path";
import {
  type ClientState,
  ClientStateSchema,
  type ClientSummary,
} from "#protocol/client.ts";
import { CLIENT_PROJECT } from "#protocol/paths.ts";
import { ClientRefusedError } from "#protocol/client-socket.ts";
import { clientRequest } from "./client-socket.ts";
import { DaemonError } from "./http.ts";

/**
 * Real Minecraft clients (the-storm's Fabric preview mod) owned by the daemon.
 * Each session is a `gradle runClient` process with a private bootstrap and
 * control socket; the mod joins the sandbox's loopback game port in offline
 * mode. The harness never imports the-storm: it only spawns the client.
 */

/** What the mod reads from `-Dstorm.client.session` (Session.java). */
export type ClientBootstrap = {
  socket: string;
  artifacts: string;
  server: string;
};

export type LaunchSpec = {
  repoRoot: string;
  bootstrapPath: string;
  bootstrap: ClientBootstrap;
  gameDir: string;
  username: string;
  logPath: string;
};

export type LaunchedClient = {
  pid: number;
  exited: Promise<number>;
  exitCode: () => number | null;
  kill: (signal: NodeJS.Signals) => void;
};

export type ClientLauncher = (spec: LaunchSpec) => LaunchedClient;

/** `mise exec -- gradle -p packages/the-storm/client runClient …` from the repo. */
export const gradleLauncher: ClientLauncher = (spec) => {
  const log = Bun.file(spec.logPath);
  const child = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(spec.repoRoot, CLIENT_PROJECT),
      "runClient",
      `-PpreviewSession=${spec.bootstrapPath}`,
      `-PpreviewGameDir=${spec.gameDir}`,
      `-PpreviewUsername=${spec.username}`,
      "--console=plain",
      "--no-daemon",
    ],
    { cwd: spec.repoRoot, stdout: log, stderr: log, stdin: "ignore" },
  );
  return {
    pid: child.pid,
    exited: child.exited,
    exitCode: () => child.exitCode,
    kill: (signal) => {
      child.kill(signal);
    },
  };
};

type Session = {
  summary: ClientSummary;
  socket: string;
  privateDir: string;
  child: LaunchedClient;
};

const POLL_MS = 500;

/** The mod's capture reply (Captures.java). */
const CaptureResultSchema = z.object({ path: z.string() });

async function isSocket(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    return info.isSocket();
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exitWithin(child: LaunchedClient, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([child.exited.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class ClientManager {
  private readonly sessions = new Map<string, Session>();
  /** Names whose start is in flight, so two starts cannot race for one name. */
  private readonly starting = new Set<string>();

  constructor(
    private readonly options: {
      repoRoot: string;
      dir: string;
      launcher: ClientLauncher;
      log: (msg: string, extra?: Record<string, unknown>) => void;
      readyTimeoutMs?: number;
      stopTimeoutMs?: number;
    },
  ) {}

  list(): ClientSummary[] {
    return [...this.sessions.values()].map((session) => session.summary);
  }

  /** Launches a client against a sandbox's game endpoint and waits until it is in the world. */
  async start(request: {
    name: string;
    target: string;
    game: { host: string; port: number };
  }): Promise<ClientSummary> {
    const { name, target, game } = request;
    if (this.sessions.has(name) || this.starting.has(name)) {
      throw new DaemonError(`Client ${name} is already running`, 409);
    }
    if (game.host !== "127.0.0.1") {
      throw new DaemonError(
        `Sandbox ${target} has no loopback game endpoint (${game.host}); the client joins 127.0.0.1 only`,
        409,
      );
    }
    this.starting.add(name);
    try {
      return await this.launch(name, target, game.port);
    } finally {
      this.starting.delete(name);
    }
  }

  private async launch(
    name: string,
    target: string,
    port: number,
  ): Promise<ClientSummary> {
    const startedAt = new Date();
    // Socket paths are capped near 104 bytes on macOS, so the socket and
    // bootstrap live in a short private temp dir, not under ~/.toolkit.
    const privateDir = await mkdtemp(path.join(os.tmpdir(), "mc-client-"));
    await chmod(privateDir, 0o700);
    const artifacts = path.join(
      this.options.dir,
      `${name}-${startedAt.getTime().toString()}`,
    );
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    const bootstrap: ClientBootstrap = {
      socket: path.join(privateDir, "client.sock"),
      artifacts,
      server: `127.0.0.1:${port.toString()}`,
    };
    const bootstrapPath = path.join(privateDir, "bootstrap.json");
    await Bun.write(bootstrapPath, JSON.stringify(bootstrap));
    await chmod(bootstrapPath, 0o600);
    const logPath = path.join(artifacts, "client.log");
    const child = this.options.launcher({
      repoRoot: this.options.repoRoot,
      bootstrapPath,
      bootstrap,
      gameDir: path.join(privateDir, "game"),
      username: name,
      logPath,
    });
    const session: Session = {
      summary: {
        name,
        target,
        server: bootstrap.server,
        pid: child.pid,
        startedAt: startedAt.toISOString(),
        artifacts,
      },
      socket: bootstrap.socket,
      privateDir,
      child,
    };
    this.sessions.set(name, session);
    void this.reapOnExit(session);
    this.options.log("client starting", { name, target, pid: child.pid });
    try {
      await this.waitUntilJoined(session, logPath);
    } catch (error) {
      await this.stopSession(session);
      throw new DaemonError(describe(error), 502);
    }
    this.options.log("client joined", { name, target });
    return session.summary;
  }

  private async reapOnExit(session: Session): Promise<void> {
    const code = await session.child.exited;
    await this.ended(session, code);
  }

  private async waitUntilJoined(
    session: Session,
    logPath: string,
  ): Promise<void> {
    const timeoutMs = this.options.readyTimeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    let lastError = "the control socket never appeared";
    while (Date.now() < deadline) {
      const code = session.child.exitCode();
      if (code !== null) {
        throw new Error(
          `Client exited (${code.toString()}) before joining; see ${logPath}`,
        );
      }
      if (await isSocket(session.socket)) {
        try {
          const state = ClientStateSchema.parse(
            await clientRequest(session.socket, "status"),
          );
          if (state.connected) {
            return;
          }
          lastError = `still on screen "${state.screen}"`;
        } catch (error) {
          lastError = describe(error);
        }
      }
      await Bun.sleep(POLL_MS);
    }
    throw new Error(
      `Client did not join ${session.summary.server} within ${String(timeoutMs / 1000)}s (${lastError}); see ${logPath}`,
    );
  }

  private session(name: string): Session {
    const session = this.sessions.get(name);
    if (session === undefined) {
      throw new DaemonError(`No client ${name}`, 404);
    }
    return session;
  }

  /** One request to a running client, journaled to its commands.jsonl. */
  async request(
    name: string,
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const session = this.session(name);
    const started = performance.now();
    const journal = (entry: Record<string, unknown>) =>
      appendFile(
        path.join(session.summary.artifacts, "commands.jsonl"),
        `${JSON.stringify({
          at: new Date().toISOString(),
          action,
          arguments: args,
          durationMs: Math.round(performance.now() - started),
          ...entry,
        })}\n`,
      );
    try {
      const result = await clientRequest(session.socket, action, args);
      await journal({ ok: true, result: action === "status" ? "…" : result });
      return result;
    } catch (error) {
      await journal({ ok: false, error: describe(error) });
      if (error instanceof ClientRefusedError) {
        throw new DaemonError(`client ${name}: ${error.message}`, 409);
      }
      throw new DaemonError(`client ${name}: ${describe(error)}`, 502);
    }
  }

  async status(
    name: string,
  ): Promise<{ client: ClientSummary; state: ClientState }> {
    const session = this.session(name);
    const state = ClientStateSchema.parse(await this.request(name, "status"));
    return { client: session.summary, state };
  }

  /** Screenshot of the rendered frame; copied to `out` when given. */
  async capture(name: string, out: string | undefined): Promise<string> {
    const result = await this.request(name, "capture", {
      name: `capture-${Date.now().toString()}`,
    });
    const parsed = CaptureResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new DaemonError(`client ${name}: capture returned no path`, 502);
    }
    const saved = parsed.data.path;
    if (out === undefined) {
      return saved;
    }
    await mkdir(path.dirname(out), { recursive: true });
    await copyFile(saved, out);
    return out;
  }

  async stop(name: string): Promise<void> {
    await this.stopSession(this.session(name));
  }

  /** Stops every client joined to a sandbox that is going away. */
  async stopForTarget(target: string): Promise<string[]> {
    const names = this.list()
      .filter((summary) => summary.target === target)
      .map((summary) => summary.name);
    await Promise.all(names.map(async (name) => this.stop(name)));
    return names;
  }

  async stopAll(): Promise<string[]> {
    const names = this.list().map((summary) => summary.name);
    await Promise.all(names.map(async (name) => this.stop(name)));
    return names;
  }

  /** Asks the game to quit, then escalates to SIGTERM and SIGKILL. */
  private async stopSession(session: Session): Promise<void> {
    const { child } = session;
    const grace = this.options.stopTimeoutMs ?? 30_000;
    if (child.exitCode() === null) {
      try {
        await clientRequest(session.socket, "shutdown", {}, 5000);
      } catch {
        // Not answering is what the signals below are for.
      }
      if (!(await exitWithin(child, grace))) {
        child.kill("SIGTERM");
        if (!(await exitWithin(child, grace / 3))) {
          child.kill("SIGKILL");
          await child.exited;
        }
      }
    }
    await this.ended(session, child.exitCode());
  }

  private async ended(session: Session, code: number | null): Promise<void> {
    if (this.sessions.get(session.summary.name) !== session) {
      return;
    }
    this.sessions.delete(session.summary.name);
    // privateDir is the exact mkdtemp result for this session.
    await rm(session.privateDir, { recursive: true, force: true });
    this.options.log("client ended", {
      name: session.summary.name,
      code,
    });
  }
}
