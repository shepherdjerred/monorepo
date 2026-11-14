import { spawn } from "node:child_process";
import { z } from "zod";

type MediaTool =
  "ffprobe" | "ffmpeg" | "7zz" | "media-subtitle-analysis" | "ffsubsync";
export class MediaToolError extends Error {
  constructor(
    readonly tool: MediaTool,
    readonly reason: "unavailable" | "failed" | "limit" | "cancelled",
  ) {
    super(`${tool}: ${reason}`);
    this.name = "MediaToolError";
  }
}

export type RunMediaTool = (
  tool: MediaTool,
  args: readonly string[],
  options: {
    maxBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
    checkpoint?: () => Promise<void>;
  },
) => Promise<Uint8Array<ArrayBuffer>>;

/** Bounded, shell-free tool invocation with a credential-free environment. */
export const runMediaTool: RunMediaTool = async (tool, args, options) => {
  options.signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const group =
      (tool === "media-subtitle-analysis" || tool === "ffsubsync") &&
      process.platform !== "win32";
    const child = spawn(tool, [...args], {
      detached: group,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" },
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let failure: MediaToolError | undefined;
    const fail = (reason: "unavailable" | "failed" | "limit" | "cancelled") => {
      failure = new MediaToolError(tool, reason);
      if (group && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (!z.object({ code: z.literal("ESRCH") }).safeParse(error).success)
            throw error;
        }
      } else child.kill("SIGKILL");
    };
    const abort = () => {
      fail("cancelled");
    };
    const timeout = setTimeout(() => {
      fail("limit");
    }, options.timeoutMs);
    let checking = false;
    const beat = async () => {
      if (checking) return;
      checking = true;
      try {
        await options.checkpoint?.();
      } catch {
        fail("cancelled");
      } finally {
        checking = false;
      }
    };
    const heartbeat =
      options.checkpoint === undefined
        ? undefined
        : setInterval(() => {
            void beat();
          }, 10_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      if (heartbeat !== undefined) clearInterval(heartbeat);
      options.signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (value: unknown) => {
      if (!Buffer.isBuffer(value)) {
        fail("failed");
        return;
      }
      length += value.byteLength;
      if (length > options.maxBytes) {
        fail("limit");
        return;
      }
      chunks.push(value);
    });
    child.once("error", () => {
      cleanup();
      reject(new MediaToolError(tool, "unavailable"));
    });
    child.once("close", (code) => {
      cleanup();
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(new MediaToolError(tool, "failed"));
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
};

const StreamSchema = z.object({
  index: z.number().int().nonnegative(),
  codec_type: z.enum(["video", "audio", "subtitle", "attachment", "data"]),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  side_data_list: z
    .array(
      z.object({
        side_data_type: z.string().optional(),
        dv_profile: z.int().nonnegative().optional(),
        bl_present_flag: z.union([z.literal(0), z.literal(1)]).optional(),
        dv_bl_signal_compatibility_id: z.int().nonnegative().max(15).optional(),
      }),
    )
    .max(100)
    .optional(),
  channels: z.number().int().positive().optional(),
  disposition: z
    .object({
      forced: z.union([z.literal(0), z.literal(1)]),
      hearing_impaired: z.union([z.literal(0), z.literal(1)]),
    })
    .optional(),
  tags: z
    .object({ language: z.string().optional(), title: z.string().optional() })
    .optional(),
});
const ProbeSchema = z.object({
  streams: z.array(StreamSchema),
  format: z.object({
    duration: z.string().regex(/^\d+(?:\.\d+)?$/u),
    size: z.string().regex(/^\d+$/u),
    format_name: z.string(),
  }),
});
export type MediaProbe = z.infer<typeof ProbeSchema>;

export async function inspectMedia(
  path: string,
  options: { run?: RunMediaTool; signal?: AbortSignal } = {},
): Promise<MediaProbe> {
  const run = options.run ?? runMediaTool;
  const bytes = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      path,
    ],
    {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 60_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  const result = ProbeSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    !result.streams.some((stream) => stream.codec_type === "video") ||
    Number(result.format.duration) <= 0 ||
    Number(result.format.size) <= 0
  )
    throw new MediaToolError("ffprobe", "failed");
  return result;
}

/** Only text subtitle codecs can be extracted into text sidecars; bitmap tracks remain embedded. */
export async function extractEmbeddedSubtitle(
  input: { path: string; streamIndex: number; codec: string },
  options: { run?: RunMediaTool; signal?: AbortSignal } = {},
): Promise<{ format: "srt" | "ass"; bytes: Uint8Array<ArrayBuffer> }> {
  z.number().int().nonnegative().parse(input.streamIndex);
  if (
    !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
      input.codec,
    )
  )
    throw new Error("Embedded subtitle requires bitmap handling");
  const format = input.codec === "ass" || input.codec === "ssa" ? "ass" : "srt";
  const run = options.run ?? runMediaTool;
  const bytes = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      input.path,
      "-map",
      `0:${String(input.streamIndex)}`,
      "-f",
      format,
      "pipe:1",
    ],
    {
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 60_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  return { format, bytes };
}
