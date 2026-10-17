import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export class FileLockError extends Error {
  constructor(readonly kind: "busy" | "unavailable" | "lost") {
    super(`Media filesystem lock ${kind}`);
    this.name = "FileLockError";
  }
}

/** Requires Python3 on macOS/Linux. Lock files remain in place; ownership is held by the kernel. */
export async function withAdvisoryLock<T>(
  path: string,
  action: (assertHeld: () => void) => Promise<T>,
): Promise<T> {
  return await withLockHelper([path], action);
}

/** Exact existing lock files, in caller order; bounded descriptors per child. */
export async function withAdvisoryLocks<T>(
  paths: readonly string[],
  action: (assertHeld: () => void) => Promise<T>,
): Promise<T> {
  if (
    paths.length === 0 ||
    paths.some((path) => path.length === 0) ||
    new Set(paths).size !== paths.length
  )
    throw new FileLockError("unavailable");
  const enter = async (
    offset: number,
    held: readonly (() => void)[],
  ): Promise<T> => {
    if (offset === paths.length) {
      const assertHeld = () => {
        for (const check of held) check();
      };
      assertHeld();
      const result = await action(assertHeld);
      assertHeld();
      return result;
    }
    const chunk = paths.slice(offset, offset + 128);
    return await withLockHelper(chunk, (assertHeld) =>
      enter(offset + chunk.length, [...held, assertHeld]),
    );
  };
  return await enter(0, []);
}

async function withLockHelper<T>(
  paths: readonly string[],
  action: (assertHeld: () => void) => Promise<T>,
): Promise<T> {
  const helper = fileURLToPath(new URL("lock-helper.py", import.meta.url));
  const first = paths[0];
  if (first === undefined) throw new FileLockError("unavailable");
  const batch = paths.length > 1;
  const child = spawn(
    "python3",
    ["-I", "-u", helper, batch ? "--batch" : first],
    {
      stdio: ["pipe", "pipe", "ignore"],
      // Python is a system runtime prerequisite; the helper inherits no application credentials.
      env: {},
    },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.once("error", () => {
      resolve();
    });
  });
  let lost = false;
  child.once("exit", () => {
    lost = true;
  });
  child.once("error", () => {
    lost = true;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new FileLockError("unavailable"));
      }, 5000);
      let buffer = "";
      const finish = () => {
        clearTimeout(timeout);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer === "locked\n") {
          finish();
          resolve();
        } else if (buffer.length > 32) {
          finish();
          reject(new FileLockError("unavailable"));
        }
      });
      child.once("error", () => {
        finish();
        reject(new FileLockError("unavailable"));
      });
      child.stdin.once("error", () => {
        finish();
        reject(new FileLockError("unavailable"));
      });
      child.once("exit", (code) => {
        finish();
        reject(new FileLockError(code === 3 ? "busy" : "unavailable"));
      });
      if (batch) child.stdin.write(`${JSON.stringify(paths)}\n`);
    });
    const assertHeld = () => {
      if (lost || child.exitCode !== null || child.signalCode !== null)
        throw new FileLockError("lost");
    };
    assertHeld();
    return await action(assertHeld);
  } finally {
    child.stdin.destroy();
    child.kill("SIGTERM");
    await exited;
  }
}
