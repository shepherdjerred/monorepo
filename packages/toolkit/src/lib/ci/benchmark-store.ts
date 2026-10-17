import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createS3Client } from "#lib/s3/client.ts";
import { benchmarkEvidence } from "./benchmark-evidence.ts";
import {
  getPipeline,
  WOODPECKER_URL,
  type WoodpeckerConfig,
} from "#lib/woodpecker/ci.ts";

const MAX_REPORT_BYTES = 128 * 1024 ** 2;
const BUCKET = "ci-handoff";

export async function boundedBenchmarkBody(
  stream: ReadableStream<unknown>,
  maxBytes = MAX_REPORT_BYTES,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const cancel = async () => {
    try {
      await reader.cancel();
    } catch {
      /* The read/finally path reports stream errors. */
    }
  };
  const abort = () => {
    void cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array))
        throw new TypeError("Benchmark artifact stream is not bytes");
      bytes += next.value.byteLength;
      if (bytes > maxBytes)
        throw new Error(
          "Benchmark artifact exceeds its size bound (maximum 128 MiB)",
        );
      chunks.push(next.value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function read(client: S3Client, key: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(60_000);
  const response = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { abortSignal: signal },
  );
  if (response.Body === undefined)
    throw new Error("Benchmark artifact body is missing");
  if (
    response.ContentLength !== undefined &&
    response.ContentLength > MAX_REPORT_BYTES
  ) {
    await response.Body.transformToWebStream().cancel();
    throw new Error("Benchmark artifact exceeds 128 MiB");
  }
  return boundedBenchmarkBody(
    response.Body.transformToWebStream(),
    MAX_REPORT_BYTES,
    signal,
  );
}

export async function inspectBenchmark(
  number: number,
  options: {
    head: string;
    variant: "baseline" | "candidate";
    profile: string;
    archive: boolean;
  },
  config: WoodpeckerConfig,
) {
  if (config.baseUrl !== WOODPECKER_URL || config.repoId !== 1)
    throw new Error(
      "Benchmark evidence belongs to the homelab monorepo connection",
    );
  const pipeline = await getPipeline(number, config);
  const client = createS3Client(options.profile);
  try {
    const raw = await read(client, `${String(number)}/diagnostics-verify.json`);
    const result = benchmarkEvidence(raw, pipeline, options);
    if (
      JSON.stringify(await getPipeline(number, config)) !==
      JSON.stringify(pipeline)
    )
      throw new Error(
        "Native benchmark state changed during evidence recovery; inspect again",
      );
    let archive: string | null = null;
    if (options.archive) {
      const body = JSON.stringify(result);
      const digest = createHash("sha256").update(body).digest("hex");
      const key = `${String(number)}/qualification-resources-${digest}.json`;
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: "application/json",
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      const retained = await read(client, key);
      if (createHash("sha256").update(retained).digest("hex") !== digest)
        throw new Error(
          "Benchmark archive readback differs from the written evidence",
        );
      archive = `s3://${BUCKET}/${key}`;
    }
    return { ...result, archive };
  } finally {
    client.destroy();
  }
}
