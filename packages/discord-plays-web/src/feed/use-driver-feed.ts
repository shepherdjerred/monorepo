import { useEffect, useRef, useState, type RefObject } from "react";
import type { FeedAudioFormat } from "./feed-audio.ts";
import {
  connectDriverFeed,
  type DriverFeedQuery,
  type DriverFeedStatus,
} from "./driver-feed-client.ts";

export type UseDriverFeedOptions = {
  /** Query parameters the game's admission policy reads. */
  readonly query?: DriverFeedQuery;
  /**
   * Called after each frame is drawn, while its pixels are on the canvas.
   * Mario Kart samples its HUD clock here.
   */
  readonly onPaint?: (context: CanvasRenderingContext2D) => void;
  readonly onDecoderReset?: () => void;
  /** One chunk of the game's sound; hand it to `useFeedSound`'s player. */
  readonly onAudio?: (pcm: DataView, format: FeedAudioFormat) => void;
};

export type DriverFeed = {
  /** Attach to the `<canvas>` the game paints into. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly status: DriverFeedStatus;
};

/**
 * Connect the live feed and paint it onto a canvas the game renders.
 *
 * The game owns the markup and styling around the canvas; this sizes the
 * canvas's backing store to the decoded frame and keeps the connection alive
 * for as long as the component is mounted and the query is unchanged.
 */
export function useDriverFeed(options: UseDriverFeedOptions = {}): DriverFeed {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<DriverFeedStatus>({
    kind: "connecting",
  });
  // Callbacks change identity every render; the connection must not.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const queryKey = JSON.stringify(options.query ?? {});

  useEffect(() => {
    // Resolve the 2D context once: getContext per frame is a measurable cost at
    // 30-60 fps and the canvas element is stable for the component's lifetime.
    let context: CanvasRenderingContext2D | null = null;

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
          // A GPU-backed, opaque, low-latency canvas. `willReadFrequently`
          // would move it to the CPU and read every decoded frame back from
          // the GPU for the occasional `onPaint` sample.
          context ??= canvas.getContext("2d", {
            alpha: false,
            desynchronized: true,
          });
          if (context === null) return;
          context.drawImage(frame, 0, 0);
          optionsRef.current.onPaint?.(context);
        },
        onDecoderReset: () => {
          optionsRef.current.onDecoderReset?.();
        },
        onAudio: (pcm, format) => {
          optionsRef.current.onAudio?.(pcm, format);
        },
      },
      optionsRef.current.query,
    );
    // queryKey stands in for the query's contents; the ref holds its value.
  }, [queryKey]);

  return { canvasRef, status };
}
