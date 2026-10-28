import { rmdir } from "node:fs/promises";

export async function closePrivateApp(options: {
  record: (stage: string) => Promise<void>;
  child: { stdin: { end: () => unknown }; exited: Promise<number> };
  reader: { cancel: () => Promise<void> };
  readStderr: () => Promise<string>;
  rejection: (stderr: string) => Promise<void>;
  socketDirectory: string;
  clear: () => void;
}) {
  let incomplete = false;
  try {
    await options.record("closing");
  } catch {
    incomplete = true;
  }
  try {
    await options.child.stdin.end();
  } catch {
    incomplete = true;
  }
  try {
    await options.reader.cancel();
  } catch {
    incomplete = true;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([
      options.child.exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Private helper cleanup deadline"));
        }, 5000);
      }),
    ]);
    const stderr = await options.readStderr();
    if (code !== 0 || stderr !== "") {
      incomplete = true;
      try {
        await options.rejection(stderr);
      } catch {
        // Invalid diagnostics never prevent exact owned socket cleanup.
      }
    }
    await rmdir(options.socketDirectory);
  } catch {
    incomplete = true;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  options.clear();
  try {
    await options.record(incomplete ? "cleanup-incomplete" : "closed");
  } catch {
    incomplete = true;
  }
  return {
    status: incomplete ? ("cleanup-incomplete" as const) : ("closed" as const),
  };
}
