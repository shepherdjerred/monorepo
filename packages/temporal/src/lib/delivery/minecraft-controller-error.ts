import { z } from "zod";

export const MinecraftProducerDiagnostic = z
  .object({
    stage: z.enum([
      "source-fingerprint",
      "restored-fingerprint",
      "verify-backup",
      "producer",
    ]),
    errorClass: z.enum([
      "ValueError",
      "RuntimeError",
      "ReadError",
      "TimeoutExpired",
      "OSError",
      "UnexpectedError",
      "ProducerExit",
    ]),
    code: z.enum([
      "unsafe-entry",
      "duplicate-entry",
      "unsupported-entry",
      "required-files-missing",
      "byte-mismatch",
      "operation-failed",
      "output-limit",
      "tar-unexpected-eof",
      "tar-truncated",
      "tar-invalid-header",
      "tar-read-error",
    ]),
    exitCode: z.number().int(),
    side: z.enum(["source", "restored"]).optional(),
    producerExit: z.number().int().nullable().optional(),
    remoteExit: z.number().int().min(0).max(255).nullable().optional(),
    stderrClass: z
      .enum([
        "permission-denied",
        "forbidden",
        "io-error",
        "file-changed",
        "timeout",
        "unexpected-eof",
        "connection-error",
        "unclassified",
      ])
      .optional(),
  })
  .strict();

export class MinecraftProducerError extends Error {
  constructor(
    readonly diagnostic: z.infer<typeof MinecraftProducerDiagnostic>,
  ) {
    super(`Minecraft producer failed: ${JSON.stringify(diagnostic)}`);
    this.name = "MinecraftProducerError";
  }
}

async function boundedText(stream: ReadableStream<Uint8Array>, limit: number) {
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  for await (const block of stream) {
    bytes += block.byteLength;
    if (text.length < limit)
      text += decoder
        .decode(block, { stream: true })
        .slice(0, limit - text.length);
  }
  return { text, exceeded: bytes > limit };
}

/** Raw child output stays bounded in memory and never enters a response or log. */
export async function runMinecraftProducer(
  command: string[],
  environment: Record<string, string | undefined>,
) {
  const child = Bun.spawn(command, {
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 2 * 60 * 60_000,
    killSignal: "SIGTERM",
  });
  const [output, errors, exitCode] = await Promise.all([
    boundedText(child.stdout, 100_000),
    boundedText(child.stderr, 32_768),
    child.exited,
  ]);
  if (exitCode === 0 && !output.exceeded) return output.text;
  const marker = (prefix: string) => {
    const line = errors.text
      .split("\n")
      .find((entry) => entry.startsWith(prefix));
    if (line === undefined) return;
    try {
      return JSON.parse(line.slice(prefix.length)) as unknown;
    } catch {
      throw new Error("Minecraft producer diagnostic JSON is invalid");
    }
  };
  const verifier = marker("MINECRAFT_VERIFIER_FAILURE ");
  const stream = marker("MINECRAFT_STREAM_FAILURE ");
  const VerifierSchema = MinecraftProducerDiagnostic.pick({
    stage: true,
    errorClass: true,
    code: true,
  });
  const StreamSchema = MinecraftProducerDiagnostic.pick({
    side: true,
    producerExit: true,
    remoteExit: true,
    stderrClass: true,
  }).required({ side: true, producerExit: true, stderrClass: true });
  const verified = VerifierSchema.safeParse(
    verifier === undefined
      ? {
          stage: "producer",
          errorClass: "ProducerExit",
          code: output.exceeded ? "output-limit" : "operation-failed",
        }
      : verifier,
  );
  const streamed =
    stream === undefined ? undefined : StreamSchema.safeParse(stream);
  if (!verified.success || (streamed !== undefined && !streamed.success))
    throw new Error("Minecraft producer diagnostic contract failed");
  const parsed = MinecraftProducerDiagnostic.safeParse({
    ...verified.data,
    ...streamed?.data,
    exitCode,
  });
  if (!parsed.success)
    throw new Error("Minecraft producer diagnostic contract failed");
  throw new MinecraftProducerError(parsed.data);
}
