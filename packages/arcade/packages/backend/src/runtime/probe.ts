/** ROM-gated media acceptance, without logging in any Discord account. */
import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { neutralController } from "@arcade/common/protocol.ts";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import { createGameLogger } from "@shepherdjerred/discord-plays-core/logger.ts";
import { nativeFormats } from "#src/games/formats.ts";
import { MkwTelemetry } from "#src/games/mkwii/telemetry.ts";
import { MeleeTelemetry } from "#src/games/melee/telemetry.ts";
import {
  BrawlMemorySchema,
  BrawlTelemetry,
} from "#src/games/brawl/telemetry.ts";
import type { GameState } from "@arcade/common/telemetry.ts";
import { browserRuntimeHost } from "./browser-host.ts";
import { DolphinHost } from "./dolphin-host.ts";
import type { RuntimeCallbacks } from "./media-peer.ts";

const { values } = parseArgs({
  options: {
    game: { type: "string" },
    assets: { type: "string" },
    output: { type: "string" },
    seconds: { type: "string", default: "30" },
    chromium: { type: "string", default: "/usr/bin/chromium" },
    dolphin: { type: "string", default: "/opt/dolphin/bin/dolphin-emu-nogui" },
    "browser-script": {
      type: "string",
      default: path.resolve(
        import.meta.dirname,
        "../../../common/dist/browser/browser.js",
      ),
    },
  },
});
const args = z
  .object({
    game: z.enum(["mkwii", "melee", "brawl"]),
    assets: z.string().min(1),
    output: z.string().min(1),
    seconds: z.coerce.number().int().min(10).max(3600),
    chromium: z.string(),
    dolphin: z.string(),
    "browser-script": z.string(),
  })
  .parse(values);
const format = nativeFormats[args.game];
const codecs = {
  mkwii: new MkwTelemetry(),
  melee: new MeleeTelemetry(),
  brawl: new BrawlTelemetry(),
};
let frame: Buffer | undefined;
let frames = 0;
let audioBytes = 0;
let state: GameState | undefined;
const failed = Promise.withResolvers<never>();
const snapshots: GameState[] = [];
const callbacks: RuntimeCallbacks = {
  frame: (bytes) => {
    frame = Buffer.from(bytes);
    frames++;
  },
  audio: (bytes) => {
    audioBytes += bytes.length;
  },
  telemetry: (raw) => {
    switch (args.game) {
      case "mkwii":
        state = codecs.mkwii.observe(raw);
        break;
      case "melee":
        state = codecs.melee.observe(raw);
        break;
      case "brawl":
        state = codecs.brawl.update(BrawlMemorySchema.parse(raw));
        break;
    }
  },
  fatal: failed.reject,
};
// Attach immediately so failures during startup cannot become unhandled.
void observeFailure();
async function observeFailure(): Promise<void> {
  try {
    await failed.promise;
  } catch {
    /* Delivered through each runtime operation's race. */
  }
}
await mkdir(args.output, { recursive: true });
const sessionDir = path.join(args.output, "session");
const host =
  args.game === "brawl"
    ? new DolphinHost({
        assets: args.assets,
        sessionDir,
        executable: args.dolphin,
        startupTimeoutMs: 180_000,
        format,
        callbacks,
        logger: createGameLogger(),
      })
    : browserRuntimeHost({
        config: {
          gameId: args.game,
          sourceRevision:
            args.game === "mkwii"
              ? "b19270fb9c1590673528a52d34ce4afb780cbee5"
              : "5bc531aafcc941866f2c916afebc38ee75543222",
          discSize: null,
          format,
        },
        assets: args.assets,
        sessionDir,
        executable: args.chromium,
        port: 9082,
        startupTimeoutMs: 180_000,
        browserScript: args["browser-script"],
        callbacks,
      });
try {
  await Promise.race([
    host.start(AbortSignal.timeout(180_000)),
    failed.promise,
  ]);
  const started = performance.now();
  for (let tick = 0; tick < args.seconds; tick++) {
    // Four independent ports; taps exercise the real controller bridge.
    for (let seat = 0; seat < 4; seat++)
      host.input(seat, {
        ...neutralController,
        buttons: [tick % 2 === 0 ? "a" : "start"],
      });
    await Promise.race([Bun.sleep(100), failed.promise]);
    for (let seat = 0; seat < 4; seat++) host.clearInput(seat);
    await Promise.race([Bun.sleep(900), failed.promise]);
    if (state !== undefined && snapshots.length < 60) snapshots.push(state);
  }
  if (frame === undefined || audioBytes === 0)
    throw new Error("Runtime has no playable media");
  await Bun.write(
    path.join(args.output, "game.png"),
    encodePng(frame, format.width, format.height),
  );
  await Bun.write(
    path.join(args.output, "observed.json"),
    JSON.stringify(
      {
        game: args.game,
        frames,
        audioBytes,
        elapsedMs: performance.now() - started,
        snapshots,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Runtime probe failed", error);
  throw error;
} finally {
  await host.stop();
}
