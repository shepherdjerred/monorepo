import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DuelClient } from "#learning/duels.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { captureObserver, offlineObserverId } from "./duel-observer.ts";
import { validateDuelClock } from "./duel-clock.ts";
import { validateDuelFrames } from "./duel-video.ts";
import { request, StatusSchema, waitFor } from "./protocol.ts";
import type { Session } from "./protocol.ts";
import { VideoStatus } from "./video-frames.ts";
import { encodeVideo } from "./video.ts";

async function digest(file: string): Promise<string> {
  return createHash("sha256")
    .update(new Uint8Array(await Bun.file(file).arrayBuffer()))
    .digest("hex");
}

/** Diagnostic original pixels and native timing; no learned controller or preference acceptance. */
export async function verifyDuelVideo(
  session: Session,
  rcon: RconClient,
): Promise<void> {
  const duels = new DuelClient(rcon);
  const observer = offlineObserverId();
  await rcon.command("gamemode spectator StormPreview");
  await rcon.command(
    "execute in minecraft:rwf run tp StormPreview 31.5 73 22.5 180 35",
  );
  await waitFor(
    "fixed native duel camera",
    async () => StatusSchema.parse(await request(session, "status")),
    (value) =>
      value.connected &&
      value.world === "minecraft:rwf" &&
      value.screen === "" &&
      value.fps > 0 &&
      Math.abs(value.position[1] - 73) < 0.1,
  );
  await captureObserver(rcon, `observe ${observer}`);
  // A separate diagnostic match initializes entity rendering and Paper combat code.
  // Its identity and outcome remain distinct from the one recorded attempt below.
  await duels.command("begin 600099999 red authored basic");
  const warmup = await duels.waitFor(
    (value) => !["waiting", "live"].includes(value.result),
    90_000,
  );
  await duels.command("cancel");
  await duels.waitFor((value) => value.phase === "LOBBY", 30_000);
  await waitFor(
    "native spectator render readiness",
    async () => z.boolean().parse(await request(session, "video-ready")),
    (ready) => ready,
  );
  const expected = {
    seed: 600_100_000,
    side: "red",
    mode: "authored",
    opponent: "basic",
  };
  await request(session, "duel-arm", {
    name: "native-duel-video",
    ...expected,
  });
  await request(session, "video-duel-arm", {
    name: "native-duel-thirty-seconds",
    fov: 70,
    ...expected,
  });
  await waitFor(
    "settled native duel framebuffer",
    async () => VideoStatus.parse(await request(session, "video-status")),
    (value) => value.state === "READY",
  );
  try {
    const began = await duels.command("begin 600100000 red authored basic");
    const results = await Promise.allSettled([
      waitFor(
        "native 900-frame window",
        async () => {
          const value = VideoStatus.parse(
            await request(session, "video-status"),
          );
          if (value.state === "FAILED") throw new Error(value.error);
          return value;
        },
        (value) => value.state === "COMPLETE",
        45_000,
      ),
      duels.waitFor(
        (value) => !["waiting", "live"].includes(value.result),
        90_000,
      ),
    ]);
    const videoResult = results[0];
    const duelResult = results[1];
    if (videoResult.status === "rejected") throw videoResult.reason;
    if (duelResult.status === "rejected") throw duelResult.reason;
    const terminal = duelResult.value;
    const frames = validateDuelFrames(
      await Bun.file(videoResult.value.receipt).json(),
    );
    const clockFile = z.string().parse(await request(session, "duel-seal"));
    const clock = validateDuelClock(await Bun.file(clockFile).json());
    const last = clock.entries.at(-1)?.marker;
    if (
      last?.match !== began.match ||
      last.match !== terminal.match ||
      last.result !== terminal.result ||
      last.tick !== terminal.sampleTick ||
      frames.duel.terminalFrame < 1 ||
      frames.duel.terminalFrame >= 899
    )
      throw new Error(
        "Native terminal video does not match the original duel outcome",
      );
    const fullStart = clock.entries[1]?.receivedElapsedNanos;
    if (fullStart === undefined)
      throw new Error("Native full clock has no live anchor");
    frames.duel.clock.entries.forEach((entry, index) => {
      const full = clock.entries[index];
      if (
        full === undefined ||
        JSON.stringify(entry.marker) !== JSON.stringify(full.marker) ||
        entry.receivedElapsedNanos - frames.duel.startedElapsedNanos !==
          full.receivedElapsedNanos - fullStart
      )
        throw new Error(
          "Rendered window differs from the separate original native clock",
        );
    });
    if (
      new Set(
        frames.frames
          .slice(0, frames.duel.terminalFrame)
          .map((entry) => entry.sha256),
      ).size < 2
    )
      throw new Error(
        "Native combat did not animate before the terminal frame",
      );
    const encoded = await encodeVideo(videoResult.value.receipt);
    if (!encoded.native_window_bound)
      throw new Error("Encoded native video lost its binding");
    await writeFile(
      path.join(session.artifacts, "duel-video-verification.json"),
      `${JSON.stringify(
        {
          schema: 1,
          kind: "rwf-native-duel-video-verification",
          acceptance: "unaccepted",
          observer,
          warmup,
          terminal,
          window: frames.duel.window,
          camera: frames.frames[0]?.frame.camera,
          receipt: videoResult.value.receipt,
          receipt_sha256: await digest(videoResult.value.receipt),
          clock: clockFile,
          clock_sha256: await digest(clockFile),
          video: encoded,
          renderedFrames: frames.duel.terminalFrame + 1,
          heldFrames: 899 - frames.duel.terminalFrame,
          terminalFrame: frames.duel.terminalFrame,
          nativeWindowBound: true,
          terminalFrameHeld: true,
          modelSpecific: false,
          humanPreferenceMeasured: false,
          rolloutEnabled: false,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } finally {
    await duels.command("cancel");
    await captureObserver(rcon, "clear");
  }
}
