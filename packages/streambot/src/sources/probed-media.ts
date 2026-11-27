/**
 * Display and layout properties of a probed source. Type-only and dependency-free on purpose:
 * `machine/types.ts` carries them on every resolved source, and the browser bundle typechecks
 * that file, so this module must not reach the Bun-only probe subprocess.
 */

/** Quarter-turn a player must apply clockwise to show the frame upright. */
export type VideoRotation = 0 | 90 | 180 | 270;

/**
 * How the selected video stream is meant to be *shown*, which is not what its stored pixel grid
 * says: anamorphic sources carry non-square pixels and phone clips carry a rotation. Everything
 * that sizes or filters the output picture reads this rather than raw `width`/`height`.
 */
export type ProbedVideo = {
  /** Displayed width / height, after pixel aspect and rotation. */
  readonly displayAspect: number;
  readonly rotation: VideoRotation;
  /** Average frames per second; absent when ffprobe reports `0/0`. */
  readonly frameRate?: number;
  readonly interlaced: boolean;
  /** ffprobe `color_space` (matrix), e.g. `bt470bg`, `smpte170m`, `bt709`. */
  readonly colorSpace?: string;
  /** ffprobe `color_range`: `tv` (limited) or `pc` (full). */
  readonly colorRange?: string;
};

/** The selected audio stream's layout as ffprobe reports it (`5.1(side)`, `7.1`, `stereo`, …). */
export type ProbedAudio = {
  readonly channels?: number;
  readonly channelLayout?: string;
};
