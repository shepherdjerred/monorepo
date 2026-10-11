// The media an engine produces. The Go-Live stream, the driver feed, and the
// overlays size themselves from this rather than from one engine's constants.
//
// Both engines draw MK64's 4:3 picture into BGRA frames, top row first, with
// s16le stereo audio. They differ in everything else:
// - n64wasm: 640x240 anamorphic (a horizontally doubled 320x240), resampled to
//   44.1 kHz by the core.
// - spaghettikart: 640x480 square pixels, at the port's native 26.8 kHz.
import type { Config } from "#src/config/schema.ts";
import {
  AUDIO_SAMPLE_RATE,
  HEIGHT,
  N64_FPS,
  WIDTH,
} from "#src/emulator/constants.ts";

/** The native port's mixer rate (HOST_BRIDGE_AUDIO_RATE in spaghetti-src). */
export const SPAGHETTI_AUDIO_SAMPLE_RATE = 26_800;
export const SPAGHETTI_WIDTH = 640;
export const SPAGHETTI_HEIGHT = 480;

export type EngineName = Config["emulator"]["engine"];

export type FrameFormat = {
  readonly width: number;
  readonly height: number;
  /**
   * Framebuffer rows per row of the 640x240 space the HUD and name labels are
   * laid out in: 1 for the anamorphic wasm frame, 2 for a square-pixel 640x480
   * frame. Scaling every vertical overlay measure by it keeps the overlays, and
   * the browser's HUD clock decoder, identical across engines.
   */
  readonly rowScale: number;
  /** Frames per second the engine delivers. */
  readonly fps: number;
  readonly audioSampleRate: number;
};

/** The wasm engine delivers frames at [emulator] fps. */
export function n64wasmFormat(fps: number): FrameFormat {
  return {
    width: WIDTH,
    height: HEIGHT,
    rowScale: 1,
    fps,
    audioSampleRate: AUDIO_SAMPLE_RATE,
  };
}

/** The wasm engine at its default (and production) 30 fps. */
export const N64WASM_FORMAT: FrameFormat = n64wasmFormat(N64_FPS);

export function spaghettiFormat(fps: number): FrameFormat {
  return {
    width: SPAGHETTI_WIDTH,
    height: SPAGHETTI_HEIGHT,
    rowScale: 2,
    fps,
    audioSampleRate: SPAGHETTI_AUDIO_SAMPLE_RATE,
  };
}

/** The format the configured engine produces, known before it boots. */
export function engineFormat(config: Config): FrameFormat {
  switch (config.emulator.engine) {
    case "n64wasm":
      return n64wasmFormat(config.emulator.fps);
    case "spaghettikart":
      return spaghettiFormat(config.spaghettikart.output_fps);
  }
}

export function frameBytes(format: FrameFormat): number {
  return format.width * format.height * 4;
}
