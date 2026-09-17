import { z } from "zod/v4";

const CredentialsSchema = z.object({
  BLUEBUBBLES_URL: z.url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
});
const ResponseSchema = z.object({ status: z.number(), data: z.unknown() });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function cancelResponseStream(stream: { cancel: () => Promise<void> }) {
  try {
    await stream.cancel();
  } catch {
    throw new Error("BlueBubbles response stream cleanup failed");
  }
}

export async function blueBubblesRequest(
  route: string,
  body: unknown,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const credentials = CredentialsSchema.parse(Bun.env);
  const base = new URL(credentials.BLUEBUBBLES_URL);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new Error("Invalid BlueBubbles bootstrap URL");
  const url = new URL(route, base);
  // BlueBubbles' REST API requires password query authentication. Never expose this URL or raw fetch errors.
  url.searchParams.set("password", credentials.BLUEBUBBLES_PASSWORD);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "BlueBubbles transport failed; check connection and server health",
    );
  }
  if (!response.ok) {
    if (response.body !== null) await cancelResponseStream(response.body);
    throw new Error(
      `BlueBubbles request failed with HTTP ${String(response.status)}`,
    );
  }
  if (response.body === null)
    throw new Error("BlueBubbles response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      let chunk: { done: boolean; value?: unknown };
      try {
        chunk = await reader.read();
      } catch {
        throw new Error("BlueBubbles response stream failed");
      }
      if (chunk.done) break;
      const value = z.instanceof(Uint8Array).parse(chunk.value);
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new Error("BlueBubbles response exceeds the transfer limit");
      chunks.push(value);
    }
  } finally {
    try {
      await cancelResponseStream(reader);
    } finally {
      reader.releaseLock();
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("BlueBubbles response is not valid JSON");
  }
  const result = ResponseSchema.parse(parsed);
  if (result.status !== 200)
    throw new Error(`BlueBubbles response status ${String(result.status)}`);
  return result.data;
}
