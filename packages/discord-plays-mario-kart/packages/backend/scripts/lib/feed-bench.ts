// A local driver-feed bench for browser harnesses: the engine, the driver
// feed, and the web server with the real controller dispatch, wired exactly as
// a session wires them, plus the PinchTab helpers that drive a tab against it.
//
// ROM-gated, so it never runs in CI.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { GameEngine } from "#src/engine/game-engine.ts";
import { SeatManager } from "#src/input/seat-manager.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import { DriverFeedService } from "#src/driver-feed/index.ts";
import { handleRequest } from "#src/webserver/dispatch.ts";
import { createWebServer } from "#src/webserver/index.ts";
import { createHarnessEngine } from "./engines.ts";

const PACKAGE_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..");
const WEB_ASSETS = path.join(PACKAGE_ROOT, "packages", "frontend", "dist");

export type FeedBench = {
  readonly engine: GameEngine;
  /** Detach the frame pipeline, stop the engine and feed, close the server. */
  readonly stop: () => Promise<void>;
};

/**
 * Boot the engine and serve the shipped frontend with the driver feed on
 * `port`. The engine is running when this resolves.
 */
export async function startFeedBench(opts: {
  rom: string | undefined;
  fps: 30 | 60;
  port: number;
  /** Called with each frame's arrival time, before the overlay. */
  onFrameArrived?: (atMs: number) => void;
}): Promise<FeedBench> {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "mk64-bench-"));
  const engine = await createHarnessEngine({
    rom: opts.rom,
    sessionDir,
    fps: opts.fps,
  });
  const { format } = engine;
  const driverFeed = new DriverFeedService({
    config: {
      enabled: true,
      height: 480,
      bitrate_kbps: 2500,
      bitrate_max_kbps: 4000,
      keyframe_interval_frames: 30,
      max_client_buffer_bytes: 2 * 1024 * 1024,
      max_clients: 4,
    },
    video: {
      hardware_acceleration: false,
      vaapi_device: "/dev/dri/renderD128",
      encoder_async_depth: 1,
    },
    format,
  });
  // Bind the port before booting the engine, so a busy port fails fast.
  const { server, socket } = createWebServer({
    port: opts.port,
    webAssetsPath: WEB_ASSETS,
    isApiEnabled: true,
    isCorsEnabled: true,
  });
  if (socket === undefined) {
    throw new Error("the bench requires the Socket.IO controller channel");
  }
  const seatManager = new SeatManager(4);
  const requests = socket.events.subscribe((event) => {
    handleRequest(event, {
      seatManager,
      emulator: engine,
      driverFeedEnabled: true,
    });
  });
  driverFeed.setDriverAdmission(
    (socketId) => seatManager.seatOf(socketId) !== null,
  );
  driverFeed.attach(server);
  await engine.init();

  // The session's per-frame pipeline: overlay, then the driver-feed tee.
  engine.onFrame((frame) => {
    opts.onFrameArrived?.(performance.now());
    applyStreamOverlays(
      frame.rgba,
      { width: format.width, height: frame.height },
      {
        epochMs: Date.now(),
        seatActivity: frame.seatActivity,
        mode: "1p",
        seats: 4,
        rowScale: format.rowScale,
        nameOverlay: undefined,
      },
    );
    driverFeed.pushFrame(frame.rgba, frame.inputReceivedAtMs);
  });
  driverFeed.startSession();
  engine.start();

  return {
    engine,
    stop: async () => {
      engine.onFrame(() => {
        // Detach: stopping the feed first would otherwise race a frame.
      });
      driverFeed.stopSession();
      await engine.stop();
      requests.unsubscribe();
      server.close();
      await rm(sessionDir, { recursive: true, force: true });
    },
  };
}

/**
 * Drive the browser through the `pinchtab` CLI rather than the REST action
 * endpoint: the CLI is the supported surface and already resolves auth, config,
 * and tab routing.
 */
export async function pinchtabCli(
  server: string,
  args: readonly string[],
): Promise<string> {
  const proc = Bun.spawn(["pinchtab", "--server", server, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`pinchtab ${args.join(" ")} failed: ${stderr || stdout}`);
  }
  return stdout;
}

const EvalSchema = z.object({ result: z.unknown() });

export async function evalInTab(
  server: string,
  tabId: string,
  script: string,
): Promise<unknown> {
  const raw = await pinchtabCli(server, [
    "eval",
    script,
    "--tab",
    tabId,
    "--json",
  ]);
  return EvalSchema.parse(JSON.parse(raw)).result;
}

/**
 * Open the controller page in a dedicated tab (so an unrelated tab in a shared
 * browser is never touched) and claim seat P1, which admits the driver feed.
 */
export async function openDriverTab(
  server: string,
  port: number,
): Promise<string> {
  const navOutput = await pinchtabCli(server, [
    "nav",
    `http://localhost:${String(port)}/`,
    "--new-tab",
    "--print-tab-id",
  ]);
  const tabId = navOutput.trim();
  if (tabId.length === 0) throw new Error("pinchtab did not return a tab id");
  // A background tab is throttled: it paints the feed in bursts, which would
  // add the browser's throttling to every latency measured off its canvas.
  await pinchtabCli(server, ["tab", tabId]);
  await Bun.sleep(5000);
  const visibility = await evalInTab(server, tabId, "document.visibilityState");
  if (visibility !== "visible") {
    throw new Error(
      `the feed tab is ${String(visibility)}; a throttled tab would skew latency`,
    );
  }
  const claimed = await evalInTab(
    server,
    tabId,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "P1",
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`,
  );
  if (claimed !== true) {
    throw new Error("could not claim controller seat P1");
  }
  return tabId;
}
