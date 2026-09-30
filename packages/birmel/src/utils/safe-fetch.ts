import {
  resolveHostAddresses,
  type HostResolver,
  validateSafePublicUrl,
} from "./safe-url.ts";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type SafeTextResponse = {
  url: string;
  contentType: string;
  text: string;
};

function redirectLocation(
  response: Response,
  currentUrl: string,
): string | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return null;
  }
  const location = response.headers.get("location");
  if (location == null || location.length === 0) {
    throw new Error(
      `HTTP ${String(response.status)} redirect omitted Location`,
    );
  }
  return new URL(location, currentUrl).toString();
}

async function readBoundedText(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`Response exceeds ${String(MAX_RESPONSE_BYTES)} bytes`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchPinnedPublicUrl(
  currentUrl: string,
  signal: AbortSignal,
  resolver: HostResolver,
): Promise<Response> {
  const { url, pinnedIp } = await validateSafePublicUrl(
    currentUrl,
    resolver,
    signal,
  );
  const target = new URL(url);
  target.hostname = pinnedIp.includes(":") ? `[${pinnedIp}]` : pinnedIp;
  return fetch(target, {
    signal,
    redirect: "manual",
    headers: {
      host: url.host,
      "user-agent": "Birmel Discord Bot/1.0",
    },
    tls: { serverName: url.hostname },
  });
}

export async function fetchSafePublicText(
  initialUrl: string,
  signal?: AbortSignal,
  resolver: HostResolver = resolveHostAddresses,
): Promise<SafeTextResponse> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combinedSignal =
    signal == null ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
  let currentUrl = initialUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetchPinnedPublicUrl(
      currentUrl,
      combinedSignal,
      resolver,
    );
    const next = redirectLocation(response, currentUrl);
    if (next != null) {
      if (redirect === MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      currentUrl = next;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${String(response.status)}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("URL does not return text content");
    }
    if (response.body == null) {
      throw new Error("Response body is empty");
    }
    return {
      url: currentUrl,
      contentType,
      text: await readBoundedText(response.body),
    };
  }
  throw new Error("Fetch failed without a response");
}
