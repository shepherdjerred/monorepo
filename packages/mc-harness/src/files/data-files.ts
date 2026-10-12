/**
 * Read-only access to a server's `/data` through the container runtime:
 * `docker exec` for Docker sandboxes, `kubectl exec` (impersonating the scoped
 * mc-harness ServiceAccount) for cluster sandboxes and live tsmc. Only
 * `realpath`, `test`, `find` and `cat` ever run inside the server.
 */
import { MAIN_CONTAINER } from "#providers/kubernetes/pod-manifest.ts";
import {
  Kubectl,
  MC_HARNESS_SERVICE_ACCOUNT,
} from "#providers/kubernetes/kubectl.ts";
import type { SandboxRecord } from "#sandbox/record.ts";

export type RawEntry = {
  /** Path relative to the listed directory. */
  rel: string;
  type: "file" | "dir" | "link" | "other";
  size: number;
  mtime: string;
};

/** A file being streamed out of the server; `done` rejects if the read failed. */
export type FileRead = {
  stream: ReadableStream<Uint8Array>;
  done: Promise<void>;
};

/** Absolute paths inside the server; callers confine them to /data. */
export type DataFiles = {
  /** The canonical path (symlinks resolved), or null when it does not exist. */
  resolve: (abs: string) => Promise<string | null>;
  /** Entries under a directory: direct children, or every descendant. */
  list: (abs: string, recursive: boolean) => Promise<RawEntry[]>;
  read: (abs: string) => FileRead;
};

/** Runs a command inside a Docker sandbox's container. */
export function dockerExecArgv(
  containerId: string,
  command: readonly string[],
): string[] {
  return ["docker", "exec", containerId, ...command];
}

/** Runs a command inside a pod's container with kubectl's scoped prefix. */
export function kubectlExecArgv(
  kubectl: Kubectl,
  pod: string,
  container: string,
  command: readonly string[],
): string[] {
  return [
    "kubectl",
    ...kubectl.argv(["exec", pod, "-c", container, "--", ...command]),
  ];
}

/** `find -printf` format: type, size, mtime (epoch seconds), relative path. */
const FIND_FORMAT = String.raw`%y\t%s\t%T@\t%P\0`;

const FIND_TYPES: Record<string, RawEntry["type"]> = {
  f: "file",
  d: "dir",
  l: "link",
};

/** Parses NUL-separated `find -printf` rows (GNU find in the itzg images). */
export function parseFindOutput(stdout: string): RawEntry[] {
  return stdout
    .split("\0")
    .filter((row) => row.length > 0)
    .map((row) => {
      const [type = "", size = "", mtime = "", ...rel] = row.split("\t");
      const seconds = Number(mtime);
      if (!/^\d+$/u.test(size) || !Number.isFinite(seconds)) {
        throw new Error(`Unexpected find output row: ${JSON.stringify(row)}`);
      }
      return {
        rel: rel.join("\t"),
        type: FIND_TYPES[type] ?? "other",
        size: Number(size),
        mtime: new Date(seconds * 1000).toISOString(),
      };
    });
}

type Spawned = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};
export type Spawn = (argv: string[]) => Spawned;

const spawnPiped: Spawn = (argv) =>
  Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });

/** DataFiles over an exec prefix (`docker exec <id>` or `kubectl … exec`). */
export class ExecDataFiles implements DataFiles {
  constructor(
    private readonly argv: (command: readonly string[]) => string[],
    private readonly spawn: Spawn = spawnPiped,
  ) {}

  private async run(
    command: readonly string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = this.spawn(this.argv(command));
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  private async check(command: readonly string[]): Promise<string> {
    const result = await this.run(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `${command[0] ?? ""} in the server failed (${result.exitCode.toString()}): ${result.stderr.trim()}`,
      );
    }
    return result.stdout;
  }

  async resolve(abs: string): Promise<string | null> {
    const exists = await this.run(["test", "-e", abs]);
    if (exists.exitCode !== 0) {
      return null;
    }
    const real = await this.check(["realpath", "-e", "--", abs]);
    return real.trim();
  }

  async list(abs: string, recursive: boolean): Promise<RawEntry[]> {
    const depth = recursive ? [] : ["-maxdepth", "1"];
    const stdout = await this.check([
      "find",
      abs,
      "-mindepth",
      "1",
      ...depth,
      "-printf",
      FIND_FORMAT,
    ]);
    return parseFindOutput(stdout);
  }

  read(abs: string): FileRead {
    const child = this.spawn(this.argv(["cat", "--", abs]));
    return { stream: child.stdout, done: succeeded(child, `cat ${abs}`) };
  }
}

/** Resolves once the child exits 0; rejects with its stderr otherwise. */
async function succeeded(child: Spawned, what: string): Promise<void> {
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${what} in the server failed (${exitCode.toString()}): ${stderr.trim()}`,
    );
  }
}

/** The data files of a sandbox, through the provider that runs it. */
export function sandboxDataFiles(record: SandboxRecord): DataFiles {
  const ref = record.providerRef;
  if (ref.kind === "docker") {
    return new ExecDataFiles((command) =>
      dockerExecArgv(ref.containerId, command),
    );
  }
  const kubectl = new Kubectl({
    context: ref.context,
    namespace: ref.namespace,
    as: MC_HARNESS_SERVICE_ACCOUNT,
  });
  return new ExecDataFiles((command) =>
    kubectlExecArgv(kubectl, ref.pod, MAIN_CONTAINER, command),
  );
}
