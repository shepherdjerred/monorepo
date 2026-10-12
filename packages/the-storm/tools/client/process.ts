import path from "node:path";
import { chmod } from "node:fs/promises";
import { request, socketReady, StatusSchema, waitFor } from "./protocol.ts";
import type { Session } from "./protocol.ts";

/** Owns one ordinary native client; no launcher profile or desktop capture is involved. */
export async function startClient(options: {
  session: Session;
  privateDir: string;
  packageRoot: string;
  onExit: () => void;
}) {
  const { session, privateDir, packageRoot, onExit } = options;
  const bootstrap = path.join(privateDir, "bootstrap.json");
  const { control: _control, ...config } = session;
  await Bun.write(bootstrap, JSON.stringify(config));
  await chmod(bootstrap, 0o600);
  const log = Bun.file(path.join(session.artifacts, "client.log"));
  const child = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(packageRoot, "client"),
      "runClient",
      `-PpreviewSession=${bootstrap}`,
      `-PpreviewGameDir=${path.join(privateDir, "game")}`,
      "--console=plain",
      "--no-daemon",
    ],
    { stdout: log, stderr: log },
  );
  const stop = async () => {
    if (child.exitCode !== null) return;
    await request(session, "shutdown").catch(() => {
      child.kill("SIGTERM");
    });
    const { promise, resolve } = Promise.withResolvers<null>();
    const timer = setTimeout(() => {
      resolve(null);
    }, 30_000);
    try {
      if ((await Promise.race([child.exited, promise])) === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    } finally {
      clearTimeout(timer);
    }
  };
  const watch = async () => {
    await child.exited;
    onExit();
  };
  void watch();
  try {
    await waitFor(
      "real client to join",
      async () => {
        if (child.exitCode !== null)
          throw new Error(
            `Client exited (${child.exitCode.toString()}); inspect ${log.name ?? "client.log"}`,
          );
        return (await socketReady(session.socket))
          ? StatusSchema.parse(await request(session, "status")).connected
          : false;
      },
      (connected) => connected,
      180_000,
    );
    return { stop, alive: () => child.exitCode === null };
  } catch (error) {
    await stop();
    throw error;
  }
}
