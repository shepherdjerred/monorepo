import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

import { TaskStateSchema, type TaskState } from "#src/domain/schemas.ts";
import { issueStatePath, type RuntimePaths } from "#src/runtime/paths.ts";

function advisoryLockCommand(lockPath: string): {
  command: string[];
  busyExitCode: number;
} {
  if (process.platform === "darwin") {
    return {
      command: ["/usr/bin/lockf", "-t", "0", lockPath, "/bin/cat"],
      busyExitCode: 75,
    };
  }
  if (process.platform === "linux") {
    return {
      command: ["/usr/bin/flock", "-n", lockPath, "/bin/cat"],
      busyExitCode: 1,
    };
  }
  throw new Error(`Unsupported host platform for locking: ${process.platform}`);
}

async function acquireLock(
  lockPath: string,
): Promise<(() => Promise<void>) | undefined> {
  const { command, busyExitCode } = advisoryLockCommand(lockPath);
  const child = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  let acquired: boolean;
  try {
    await child.stdin.write("1");
    await child.stdin.flush();
    const reader = child.stdout.getReader();
    const result = await reader.read();
    reader.releaseLock();
    acquired = result.value?.[0] === 49;
  } catch {
    acquired = false;
  }
  if (!acquired) {
    await child.stdin.end();
    const [exitCode, errorOutput] = await Promise.all([child.exited, stderr]);
    if (exitCode === busyExitCode) return undefined;
    throw new Error(
      `Failed to acquire the reconcile lock (exit ${String(exitCode)}): ${errorOutput.trim()}`,
    );
  }
  return async () => {
    await child.stdin.end();
    const [exitCode, errorOutput] = await Promise.all([child.exited, stderr]);
    if (exitCode !== 0) {
      throw new Error(
        `Failed to release the reconcile lock (exit ${String(exitCode)}): ${errorOutput.trim()}`,
      );
    }
  };
}

export class StateStore {
  public constructor(private readonly paths: RuntimePaths) {}

  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.root, { recursive: true }),
      mkdir(this.paths.tasks, { recursive: true }),
      mkdir(this.paths.state, { recursive: true }),
      mkdir(this.paths.logs, { recursive: true }),
    ]);
  }

  public async withLock<T>(work: () => Promise<T>): Promise<T | undefined> {
    await this.initialize();
    const release = await acquireLock(this.paths.lock);
    if (release === undefined) return undefined;
    try {
      return await work();
    } finally {
      await release();
    }
  }

  public async list(): Promise<TaskState[]> {
    await this.initialize();
    const entries = await readdir(this.paths.state, { withFileTypes: true });
    const states = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const contents: unknown = await Bun.file(
            path.join(this.paths.state, entry.name),
          ).json();
          return TaskStateSchema.parse(contents);
        }),
    );
    return states.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  public async save(state: TaskState): Promise<void> {
    await this.initialize();
    const parsed = TaskStateSchema.parse(state);
    const destination = issueStatePath(this.paths, parsed.issue.identifier);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(parsed, null, 2)}\n`);
    await rename(temporary, destination);
  }
}
