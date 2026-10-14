/** Pace native video from the 48 kHz stereo PCM clock, including slow renders.
 * One latest frame is retained; no desktop capture or growing frame queue.
 */
export class NativeMediaClock {
  private frame: { bytes: Buffer; timeMs: number } | undefined;
  private samples = 0;
  private nextVideoSample = 0;

  constructor(
    private readonly output: {
      frame: (bytes: Buffer, timeMs: number) => void;
      audio: (bytes: Buffer, timeMs: number) => void;
    },
  ) {}

  video(bytes: Buffer, timeMs: number): void {
    this.frame = { bytes, timeMs };
  }

  audio(bytes: Buffer, timeMs: number): void {
    const frame = this.frame;
    if (frame === undefined) return;
    if (bytes.length % 4 !== 0) throw new Error("Partial stereo PCM sample");
    this.samples += bytes.length / 4;
    while (this.nextVideoSample < this.samples) {
      this.output.frame(frame.bytes, frame.timeMs);
      this.nextVideoSample += 1600;
    }
    this.output.audio(bytes, timeMs);
  }
}
