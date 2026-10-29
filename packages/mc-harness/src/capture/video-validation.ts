import { z } from "zod";

const ProbeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
      nb_read_frames: z.string().optional(),
      duration: z.string().optional(),
    }),
  ),
});

/** Both derivatives must contain every requested real frame, at the declared cadence. */
export function verifyVideo(value: unknown, frames: number): void {
  const { streams } = ProbeSchema.parse(value);
  const stream = streams[0];
  if (
    streams.length !== 1 ||
    stream?.codec_type !== "video" ||
    stream.width !== 1280 ||
    stream.height !== 720 ||
    stream.avg_frame_rate !== "30/1" ||
    Number(stream.nb_read_frames) !== frames ||
    !Number.isFinite(Number(stream.duration)) ||
    Math.abs(Number(stream.duration) - frames / 30) > 0.001
  )
    throw new Error("Encoded video differs from the framebuffer receipt");
}
