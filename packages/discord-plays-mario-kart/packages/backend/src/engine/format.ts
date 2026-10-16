// The media the engine produces. The Go-Live stream, the driver feed, and the
// overlays size themselves from this rather than from constants of their own.
import type { RuntimeConfig as Config } from "#src/config/schema.ts";
import { AUDIO_SAMPLE_RATE, HEIGHT, WIDTH } from "#src/emulator/constants.ts";

export type FrameFormat = {
  readonly width: number;
  readonly height: number;
  /**
   * Framebuffer rows per row of the 640x240 space the HUD and name labels are
   * laid out in. The browser's HUD clock decoder reads that layout, so a
   * 640x480 frame draws every vertical overlay measure twice.
   */
  readonly rowScale: number;
  /** Frames per second the engine delivers. */
  readonly fps: number;
  readonly audioSampleRate: number;
};

export function spaghettiFormat(fps: number): FrameFormat {
  return {
    width: WIDTH,
    height: HEIGHT,
    rowScale: 2,
    fps,
    audioSampleRate: AUDIO_SAMPLE_RATE,
  };
}

/** The format the configured engine produces, known before it boots. */
export function engineFormat(config: Config): FrameFormat {
  return spaghettiFormat(config.spaghettikart.output_fps);
}

export function frameBytes(format: FrameFormat): number {
  return format.width * format.height * 4;
}
