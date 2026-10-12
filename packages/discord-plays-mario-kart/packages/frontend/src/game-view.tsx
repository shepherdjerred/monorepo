import { useEffect, useRef, useState } from "react";
import {
  decodeHudClock,
  latencyMsFromClock,
} from "@discord-plays-mario-kart/common";
import { connectDriverFeed, type DriverFeedStatus } from "#src/video.ts";
import { hudClockRegion, samplerForImageData } from "#src/hud-clock.ts";
import { feedTelemetry } from "#src/feed-telemetry.ts";
import { FeedAudioPlayer } from "#src/feed-audio.ts";
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

function loadMuted(): boolean {
  try {
    return globalThis.localStorage.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function storeMuted(muted: boolean): void {
  try {
    globalThis.localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
  } catch {
    // A blocked store only means the choice is not remembered next visit.
  }
}

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<DriverFeedStatus>({
    kind: "connecting",
  });
  const [latencyMs, setLatencyMs] = useState<number>();
  const [muted, setMuted] = useState(loadMuted);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audioRef = useRef<FeedAudioPlayer>(undefined);
  // Read once at mount; later toggles go straight to the live player.
  const initialMutedRef = useRef(muted);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
    storeMuted(next);
  };

  useEffect(() => {
    const player = new FeedAudioPlayer(initialMutedRef.current);
    audioRef.current = player;
    setSoundBlocked(!player.running);
    // Autoplay policy keeps the context suspended until a user gesture; the
    // first click or key press on the page (claiming a seat, driving) starts it.
    const resume = async () => {
      await player.unlock();
      setSoundBlocked(!player.running);
      if (player.running) removeListeners();
    };
    const unlock = () => {
      void resume();
    };
    const removeListeners = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      removeListeners();
      audioRef.current = undefined;
      player.close();
    };
  }, []);

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
          // A GPU-backed, opaque, low-latency canvas. `willReadFrequently` would
          // move it to the CPU and read every decoded frame back from the GPU
          // just so the HUD clock can be sampled four times a second.
          context ??= canvas.getContext("2d", {
            alpha: false,
            desynchronized: true,
          });
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
          const glassMs = latencyMsFromClock(
            captured,
            feedTelemetry.serverNow(now),
          );
          feedTelemetry.recordGlass(glassMs);
          setLatencyMs(Math.round(glassMs));
        },
        onDecoderReset: () => {
          feedTelemetry.recordDecoderReset();
        },
        onAudio: (pcm, format) => {
          audioRef.current?.play(pcm, format);
        },
      },
      driverSocketId,
    );
  }, [driverSocketId]);

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
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="relative flex size-2">
            <span
              className={cx(
                "absolute inline-flex size-full rounded-full",
                status.kind === "playing"
                  ? "animate-pulse-dot bg-brand"
                  : "bg-ink-faint",
              )}
            />
          </span>
          Live feed
        </span>
        <div className="flex items-center gap-3">
          {glass}
          {soundButton}
        </div>
      </div>
      <div className="px-2 pb-2 sm:px-3 sm:pb-3">{screen}</div>
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
