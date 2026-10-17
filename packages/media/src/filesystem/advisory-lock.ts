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
  const helper = fileURLToPath(new URL("lock-helper.py", import.meta.url));
  const child = spawn("python3", ["-I", "-u", helper, path], {
    stdio: ["pipe", "pipe", "ignore"],
    // Python is a system runtime prerequisite; the helper inherits no application credentials.
    env: {},
  });
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
      child.once("exit", (code) => {
        finish();
        reject(new FileLockError(code === 3 ? "busy" : "unavailable"));
      });
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
