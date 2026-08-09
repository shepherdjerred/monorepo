import { useEffect, useRef, useState } from "react";
import {
  decodeHudClock,
  latencyMsFromClock,
} from "@discord-plays-mario-kart/common";
import { connectDriverFeed, type DriverFeedStatus } from "#src/video.ts";
import { hudClockRegion, samplerForImageData } from "#src/hud-clock.ts";

/** How often to read the HUD clock back off the canvas. */
const LATENCY_SAMPLE_INTERVAL_MS = 250;
/** Consecutive failed decodes before the readout admits it has lost the clock. */
const LATENCY_FAILURE_TOLERANCE = 8;

/**
 * The live game, decoded in this tab.
 *
 * Spectators watch the Discord Go-Live stream; the people driving watch this,
 * which skips Discord's voice leg and its client-side de-jitter buffer. Audio
 * still comes from Discord, so what you see here runs slightly ahead of what
 * you hear.
 */
export function GameView({ driverSocketId }: { driverSocketId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<DriverFeedStatus>({
    kind: "connecting",
  });
  const [latencyMs, setLatencyMs] = useState<number>();

  useEffect(() => {
    // Resolve the 2D context once: getContext per frame is a measurable cost at
    // 30fps and the canvas element is stable for the component's lifetime.
    let context: CanvasRenderingContext2D | null = null;
    let lastSampleAt = 0;
    let consecutiveFailures = 0;

    return connectDriverFeed(
      {
        onStatus: setStatus,
        paint: (frame) => {
          const canvas = canvasRef.current;
          if (canvas === null) return;
          if (canvas.width !== frame.displayWidth) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            context = null;
          }
          context ??= canvas.getContext("2d", { willReadFrequently: true });
          if (context === null) return;
          context.drawImage(frame, 0, 0);

          const now = Date.now();
          if (now - lastSampleAt < LATENCY_SAMPLE_INTERVAL_MS) return;
          lastSampleAt = now;

          // The backend burns the capture-time UTC clock into every frame and the
          // driver feed tees after that overlay, so these pixels carry the instant
          // they were produced. Reading them back measures capture-to-paint with
          // no extra protocol.
          const region = hudClockRegion(canvas.width, canvas.height);
          const pixels = context.getImageData(
            region.x,
            region.y,
            region.width,
            region.height,
          );
          const captured = decodeHudClock(
            samplerForImageData(pixels, region, canvas.width, canvas.height),
          );
          if (captured === undefined) {
            consecutiveFailures++;
            // A smeared frame is normal; a persistently unreadable badge is not,
            // and showing a frozen number would be worse than showing none.
            if (consecutiveFailures >= LATENCY_FAILURE_TOLERANCE) {
              setLatencyMs(undefined);
            }
            return;
          }
          consecutiveFailures = 0;
          setLatencyMs(latencyMsFromClock(captured, now));
        },
      },
      driverSocketId,
    );
  }, [driverSocketId]);

  return (
    <div className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-3 shadow-2xl shadow-black/40 sm:p-5">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-zinc-500">
        <span className="font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Live feed
        </span>
        {latencyMs !== undefined && (
          <span
            className="font-mono"
            title="Capture-to-paint, read off the clock burned into each frame. Assumes your clock and the server's are both NTP-synced; excludes your display's own latency."
          >
            {latencyMs}ms to glass
          </span>
        )}
      </div>
      <div className="relative mx-auto aspect-[4/3] w-full max-w-3xl">
        <canvas
          ref={canvasRef}
          className="h-full w-full rounded-xl bg-black object-contain"
        />
        {status.kind !== "playing" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/70 px-6 text-center text-sm text-zinc-300">
            <StatusMessage status={status} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusMessage({ status }: { status: DriverFeedStatus }) {
  switch (status.kind) {
    case "unsupported":
      return (
        <span>
          This browser can&apos;t decode the in-page feed. Watch the stream in
          Discord instead.
        </span>
      );
    case "connecting":
      return <span>Connecting to the game feed…</span>;
    case "waiting":
      return <span>Waiting for the next keyframe…</span>;
    case "error":
      return <span className="text-amber-300">{status.message}</span>;
    case "playing":
      return null;
  }
}
