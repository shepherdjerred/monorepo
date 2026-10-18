import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import { requireEnv } from "./run.ts";

export type S3ReadbackOptions = {
  signal?: AbortSignal;
  sourceDir: string;
  bucket: string;
  paths: readonly string[];
  scratchDir: string;
  endpoint: string;
  env: Record<string, string>;
};

/** Compare local files as bytes so binary static assets are certified exactly. */
export async function filesHaveSameBytes(
  expectedPath: string,
  actualPath: string,
): Promise<boolean> {
  const [expected, actual] = await Promise.all([
    Bun.file(expectedPath).bytes(),
    Bun.file(actualPath).bytes(),
  ]);
  return (
    expected.length === actual.length &&
    !expected.some((byte, index) => byte !== actual[index])
  );
}

async function sha256Stream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of stream) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Read exact selected keys without the CLI's quadratic include-filter cost. */
export async function directS3ObjectMatchesSource(
  opts: S3ReadbackOptions,
  path: string,
): Promise<boolean> {
  const region = opts.env["AWS_DEFAULT_REGION"];
  if (region === undefined || region === "")
    throw new Error(
      "S3 readback requires AWS_DEFAULT_REGION in its environment",
    );
  const request = createSignedS3Request(
    {
      accessKeyId:
        opts.env["AWS_ACCESS_KEY_ID"] ?? requireEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey:
        opts.env["AWS_SECRET_ACCESS_KEY"] ??
        requireEnv("AWS_SECRET_ACCESS_KEY"),
      sessionToken: Bun.env["AWS_SESSION_TOKEN"],
      endpoint: opts.endpoint,
      bucket: opts.bucket,
      region,
      forcePathStyle: true,
    },
    {
      method: "GET",
      key: path,
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        ...(opts.signal === undefined ? [] : [opts.signal]),
      ]),
    },
  );
  const response = await fetch(request);
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new Error(
      `S3 readback failed for s3://${opts.bucket}/${path} (HTTP ${response.status.toString()})`,
    );
  }
  const [expected, served] = await Promise.all([
    sha256Stream(Bun.file(`${opts.sourceDir}/${path}`).stream()),
    sha256Stream(response.body),
  ]);
  return expected === served;
}
