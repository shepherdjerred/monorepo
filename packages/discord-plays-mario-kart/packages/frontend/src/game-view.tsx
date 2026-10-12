import { useRef, useState } from "react";
import {
  decodeHudClock,
  latencyMsFromClock,
} from "@discord-plays-mario-kart/common";
import type { DriverFeedStatus } from "@shepherdjerred/discord-plays-web/feed/driver-feed-client.ts";
import { useDriverFeed } from "@shepherdjerred/discord-plays-web/feed/use-driver-feed.ts";
import { useFeedSound } from "@shepherdjerred/discord-plays-web/feed/use-feed-sound.ts";
import { hudClockRegion, samplerForImageData } from "#src/hud-clock.ts";
import { feedTelemetry } from "#src/feed-telemetry.ts";
import { Card } from "#src/ui/card.tsx";
import { cx } from "#src/ui/cx.ts";
import IconSpeakerOn from "~icons/ph/speaker-high-fill";
import IconSpeakerOff from "~icons/ph/speaker-slash-fill";
import IconSpinner from "~icons/ph/circle-notch-bold";

/** How often to read the HUD clock back off the canvas. */
const LATENCY_SAMPLE_INTERVAL_MS = 250;
/** Consecutive failed decodes before the readout admits it has lost the clock. */
const LATENCY_FAILURE_TOLERANCE = 8;
const MUTED_STORAGE_KEY = "dpmk-feed-muted";

/**
 * The live game, decoded in this tab.
 *
 * Spectators watch the Discord Go-Live stream; the people driving watch this,
 * which skips Discord's voice leg and its client-side de-jitter buffer. The
 * game's sound arrives on the same socket and trails the picture by the
 * player's small jitter lead.
 */
export function GameView({
  driverSocketId,
  variant = "card",
}: {
  driverSocketId: string;
  /** `bare` fills its parent with no chrome, for the phone controller. */
  variant?: "card" | "bare";
}) {
  const [latencyMs, setLatencyMs] = useState<number>();
  const sound = useFeedSound(MUTED_STORAGE_KEY);
  const { muted, toggleMuted } = sound;
  const soundBlocked = sound.blocked;
  const sampling = useRef({ lastSampleAt: 0, consecutiveFailures: 0 });

  const sampleHudClock = (context: CanvasRenderingContext2D) => {
    const now = Date.now();
    const state = sampling.current;
    if (now - state.lastSampleAt < LATENCY_SAMPLE_INTERVAL_MS) return;
    state.lastSampleAt = now;

    // The backend burns the capture-time UTC clock into every frame and the
    // driver feed tees after that overlay, so these pixels carry the instant
    // they were produced. Reading them back measures capture-to-paint with
    // no extra protocol.
    const { width, height } = context.canvas;
    const region = hudClockRegion(width, height);
    const pixels = context.getImageData(
      region.x,
      region.y,
      region.width,
      region.height,
    );
    const captured = decodeHudClock(
      samplerForImageData(pixels, region, width, height),
    );
    if (captured === undefined) {
      state.consecutiveFailures++;
      // A smeared frame is normal; a persistently unreadable badge is not,
      // and showing a frozen number would be worse than showing none.
      if (state.consecutiveFailures >= LATENCY_FAILURE_TOLERANCE) {
        setLatencyMs(undefined);
      }
      return;
    }
    state.consecutiveFailures = 0;
    const glassMs = latencyMsFromClock(captured, feedTelemetry.serverNow(now));
    feedTelemetry.recordGlass(glassMs);
    setLatencyMs(Math.round(glassMs));
  };

  const { canvasRef, status } = useDriverFeed({
    query: { driverSocketId },
    onPaint: sampleHudClock,
    onDecoderReset: () => {
      feedTelemetry.recordDecoderReset();
    },
    onAudio: sound.play,
  });

  const soundLabel = muted
    ? "Sound off"
    : soundBlocked
      ? "Click to enable sound"
      : "Sound on";

  const screen = (
    <div
      className={cx(
        "relative aspect-[4/3] overflow-hidden bg-black",
        variant === "card"
          ? // Fit the 4:3 picture in the viewport height on wide screens, so
            // the controller below it stays in reach.
            "mx-auto w-full max-w-[calc((100dvh-16rem)*4/3)] rounded-xl ring-1 ring-white/5"
          : "h-full max-h-full max-w-full rounded-lg",
      )}
    >
      <canvas ref={canvasRef} className="block h-full w-full object-contain" />
      {status.kind === "playing" ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-sm text-ink-muted">
          <StatusMessage status={status} />
        </div>
      )}
    </div>
  );

  const soundButton = (
    <button
      type="button"
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors",
        soundBlocked && !muted
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
          : "border-border-strong text-ink-muted hover:text-ink",
      )}
      aria-pressed={!muted}
      onClick={() => {
        // While blocked, this click is the gesture that starts the sound
        // (the page-wide pointerdown listener); it must not also mute it.
        if (soundBlocked) {
          return;
        }
        toggleMuted();
      }}
    >
      {muted ? <IconSpeakerOff /> : <IconSpeakerOn />}
      {soundLabel}
    </button>
  );

  const glass =
    latencyMs === undefined ? null : (
      <span
        className="font-mono text-xs text-ink-faint tabular-nums"
        title="Capture-to-paint, read off the clock burned into each frame and corrected for the offset between your clock and the server's. Excludes your display's own latency."
      >
        {latencyMs}ms to glass
      </span>
    );

  if (variant === "bare") {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-1">
        {screen}
        <div className="flex items-center gap-3">
          {glass}
          {soundButton}
        </div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2.5 sm:px-5">
        <span className="mk-title flex items-center gap-2 text-lg text-white">
          <span className="relative flex size-2">
            <span
              className={cx(
                "absolute inline-flex size-full rounded-full",
                status.kind === "playing"
                  ? "animate-pulse-dot bg-mk-red"
                  : "bg-ink-faint",
              )}
            />
          </span>
          Live
        </span>
        <div className="flex items-center gap-3">
          {glass}
          {soundButton}
        </div>
      </div>
      <div className="px-2 pb-2 sm:px-3 sm:pb-3">
        <div className="mx-auto max-w-[calc((100dvh-16rem)*4/3+0.5rem)] rounded-[14px] bg-[linear-gradient(180deg,#2a3570,#141b45)] p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
          {screen}
        </div>
      </div>
    </Card>
  );
}

function StatusMessage({ status }: { status: DriverFeedStatus }) {
  switch (status.kind) {
    case "unsupported": {
      return (
        <span>
          This browser can&apos;t decode the in-page feed. Watch the stream in
          Discord instead.
        </span>
      );
    }
    case "connecting": {
      return (
        <>
          <IconSpinner className="size-6 animate-spin text-ink-faint" />
          <span>Connecting to the game feed…</span>
        </>
      );
    }
    case "waiting": {
      return (
        <>
          <IconSpinner className="size-6 animate-spin text-ink-faint" />
          <span>Waiting for the next keyframe…</span>
        </>
      );
    }
    case "error": {
      return <span className="text-amber-300">{status.message}</span>;
    }
    case "playing": {
      return null;
    }
  }
}
