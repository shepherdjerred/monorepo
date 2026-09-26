import { z } from "zod/v4";
import { ApplicationFailure } from "@temporalio/common";

const CredentialsSchema = z.object({
  BLUEBUBBLES_URL: z.url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
});
const ResponseSchema = z.object({ status: z.number(), data: z.unknown() });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
type BlueBubblesResponseReader = {
  read: () => Promise<{ done: boolean; value?: unknown }>;
  cancel: () => Promise<void>;
  releaseLock: () => void;
};

function throwBlueBubblesStatus(
  status: number,
  source: "HTTP" | "response",
): never {
  const message = `BlueBubbles request failed with ${source} ${String(status)}`;
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  ) {
    throw new Error(message);
  }
  throw ApplicationFailure.nonRetryable(message, "BlueBubblesRequestRejected");
}

function throwBlueBubblesProtocol(message: string): never {
  throw ApplicationFailure.nonRetryable(message, "BlueBubblesProtocolRejected");
}

function blueBubblesCredentials(): { base: URL; password: string } {
  const parsed = CredentialsSchema.safeParse(Bun.env);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      "Invalid BlueBubbles configuration",
      "BlueBubblesConfigurationRejected",
    );
  }
  const base = new URL(parsed.data.BLUEBUBBLES_URL);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw ApplicationFailure.nonRetryable(
      "Invalid BlueBubbles bootstrap URL",
      "BlueBubblesConfigurationRejected",
    );
  }
  return { base, password: parsed.data.BLUEBUBBLES_PASSWORD };
}

async function cancelResponseStream(stream: { cancel: () => Promise<void> }) {
  try {
    await stream.cancel();
  } catch {
    throw new Error("BlueBubbles response stream cleanup failed");
  }
}

function parseBlueBubblesResponse(
  bytes: Uint8Array,
): z.infer<typeof ResponseSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throwBlueBubblesProtocol("BlueBubbles response is not valid JSON");
  }
  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    throwBlueBubblesProtocol("BlueBubbles response envelope is invalid");
  }
  return result.data;
}

async function readResponseChunks(
  reader: BlueBubblesResponseReader,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    let chunk: { done: boolean; value?: unknown };
    try {
      chunk = await reader.read();
    } catch {
      throw new Error("BlueBubbles response stream failed");
    }
    if (chunk.done) return Buffer.concat(chunks);
    const value = z.instanceof(Uint8Array).parse(chunk.value);
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES)
      throw ApplicationFailure.nonRetryable(
        "BlueBubbles response exceeds the transfer limit",
        "BlueBubblesResponseTooLarge",
      );
    chunks.push(value);
  }
}

async function cleanupResponseReader(
  reader: BlueBubblesResponseReader,
): Promise<Error | undefined> {
  let failure: Error | undefined;
  try {
    await cancelResponseStream(reader);
  } catch (error: unknown) {
    failure =
      error instanceof Error
        ? error
        : new Error("BlueBubbles response stream cleanup failed");
  }
  try {
    reader.releaseLock();
  } catch {
    failure ??= new Error("BlueBubbles response stream cleanup failed");
  }
  return failure;
}

async function readBlueBubblesResponseBody(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = body.getReader();
  let result: Uint8Array | undefined;
  let primaryFailure: Error | undefined;
  try {
    result = await readResponseChunks(reader);
  } catch (error: unknown) {
    primaryFailure =
      error instanceof Error
        ? error
        : new Error("BlueBubbles response stream failed");
  }
  const cleanupFailure = await cleanupResponseReader(reader);
  if (primaryFailure !== undefined) throw primaryFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (result === undefined)
    throw new Error("BlueBubbles response stream failed");
  return result;
}

export async function blueBubblesRequest(
  route: string,
  body: unknown,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const credentials = blueBubblesCredentials();
  const base = credentials.base;
  const url = new URL(route, base);
  // BlueBubbles' REST API requires password query authentication. Never expose this URL or raw fetch errors.
  url.searchParams.set("password", credentials.password);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
  } catch {
    throw new Error(
      "BlueBubbles transport failed; check connection and server health",
    );
  }
  if (!response.ok) {
    try {
      if (response.body !== null) await cancelResponseStream(response.body);
    } finally {
      // Preserve the primary retry classification even if a broken response
      // body also fails while being discarded.
      throwBlueBubblesStatus(response.status, "HTTP");
    }
  }
  if (response.body === null) {
    throwBlueBubblesProtocol("BlueBubbles response has no body");
  }
  const result = parseBlueBubblesResponse(
    await readBlueBubblesResponseBody(response.body),
  );
  if (result.status !== 200) {
    throwBlueBubblesStatus(result.status, "response");
  }
  return result.data;
}
