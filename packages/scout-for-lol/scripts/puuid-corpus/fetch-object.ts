import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

export type FetchedObject = {
  body: string;
  metadata: Record<string, string>;
};

class ObjectReadDeadlineError extends Error {}

/** Headers arriving do not imply the response body will ever finish. */
async function readAttempt(
  client: S3Client,
  bucket: string,
  key: string,
  timeoutMs: number,
): Promise<FetchedObject> {
  const controller = new AbortController();
  const error = new ObjectReadDeadlineError(
    `S3 object read exceeded ${timeoutMs.toString()}ms for ${bucket}/${key}`,
  );
  let stream: Readable | undefined;
  let completed = false;
  const release = () => {
    controller.abort(error);
    stream?.destroy();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(error);
      release();
    }, timeoutMs);
  });
  const read = async (): Promise<FetchedObject> => {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: controller.signal },
    );
    if (response.Body instanceof Readable) stream = response.Body;
    if (controller.signal.aborted) {
      release();
      throw error;
    }
    if (response.Body === undefined)
      throw new Error(`S3 returned no body for ${bucket}/${key}`);
    const text = await response.Body.transformToString();
    return { body: text, metadata: response.Metadata ?? {} };
  };
  try {
    const result = await Promise.race([deadline, read()]);
    completed = true;
    return result;
  } finally {
    clearTimeout(timer);
    if (!completed) release();
  }
}

/** Retry only timed-out, cancelled GETs; never substitute missing/corrupt data. */
export async function fetchObject(
  client: S3Client,
  bucket: string,
  key: string,
  timeoutMs = 120_000,
): Promise<FetchedObject> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    throw new Error(
      "A positive integral S3 object-read deadline within timer range is required",
    );
  for (let attempt = 0; ; attempt++) {
    try {
      return await readAttempt(client, bucket, key, timeoutMs);
    } catch (error) {
      if (attempt === 2 || !(error instanceof ObjectReadDeadlineError))
        throw error;
      await Bun.sleep(250 * 2 ** attempt);
    }
  }
}
