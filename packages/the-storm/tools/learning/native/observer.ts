import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { startClient } from "#client/process.ts";
import { startControl } from "#client/control.ts";
import { captureObserver, offlineObserverId } from "#client/duel-observer.ts";
import { request, StatusSchema, waitFor } from "#client/protocol.ts";
import type { Session } from "#client/protocol.ts";

/** A native spectator owned by the exact Java-model Paper sandbox, not a second server. */
export async function openNativeObserver(options: {
  output: string;
  packageRoot: string;
  server: string;
  rcon: RconClient;
}) {
  const { output, packageRoot, server, rcon } = options;
  const child = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(packageRoot, "client"),
      "assemble",
      "--console=plain",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0)
    throw new Error("Native observer build failed");
  const privateDir = await mkdtemp(
    path.join(os.tmpdir(), "storm-model-client-"),
  );
  await chmod(privateDir, 0o700);
  const cleanup: (() => Promise<void>)[] = [
    async () => rm(privateDir, { recursive: true, force: true }),
  ];
  const stop = async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.toReversed()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Native observer cleanup failed");
  };
  try {
    await mkdir(output, { recursive: false, mode: 0o700 });
    const session: Session = {
      socket: path.join(privateDir, "client.sock"),
      control: path.join(privateDir, "control.sock"),
      artifacts: output,
      server,
    };
    let stopped = false;
    const onExit = () => {
      stopped = true;
    };
    cleanup.push(
      await startControl({
        socket: session.control,
        rcon,
        views: {},
        stop: onExit,
      }),
    );
    const client = await startClient({
      session,
      privateDir,
      packageRoot,
      onExit,
    });
    cleanup.push(client.stop);
    const requireAlive = () => {
      if (stopped || !client.alive())
        throw new Error("Owned native model observer stopped");
    };
    await rcon.command("gamemode spectator StormPreview");
    await rcon.command(
      "execute in minecraft:rwf run tp StormPreview 31.5 73 22.5 180 35",
    );
    await request(session, "close");
    await waitFor(
      "native model spectator pose",
      async () => {
        requireAlive();
        return StatusSchema.parse(await request(session, "status"));
      },
      (value) =>
        value.connected &&
        value.world === "minecraft:rwf" &&
        value.screen === "" &&
        Math.abs(value.position[1] - 73) < 0.1,
    );
    await waitFor(
      "native model spectator render readiness",
      async () => z.boolean().parse(await request(session, "video-ready")),
      (value) => value,
    );
    const observer = offlineObserverId();
    await captureObserver(rcon, `observe ${observer}`);
    cleanup.push(async () => {
      await captureObserver(rcon, "clear");
    });
    await Bun.write(
      path.join(output, "session.json"),
      JSON.stringify(session, null, 2) + "\n",
    );
    return { session, stop, requireAlive, observer };
  } catch (error) {
    await stop();
    throw error;
  }
}
