import path from "node:path";
import { z } from "zod";

/** One canonical naming rule for ordinary installation and reviewed replacement. */
export function subtitleDestination(input: {
  videoPath: string;
  language: string;
  forced: boolean | null;
  hearingImpaired: boolean | null;
  format: string;
}): string {
  const language = z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u)
    .parse(input.language);
  const format = z.enum(["srt", "ass", "ssa", "vtt"]).parse(input.format);
  const suffix = `${input.forced === true ? ".forced" : ""}${input.hearingImpaired === true ? ".sdh" : ""}`;
  return `${input.videoPath.slice(0, -path.extname(input.videoPath).length)}.${language}${suffix}.${format}`;
}
