/**
 * A conservative token bound, including provider framing overhead.
 *
 * Counted in serialized bytes (a token never takes less than one byte), so
 * this is a worst case: the standing system prompt, tool schemas and answer
 * format alone serialize to roughly 200 KB and are prompt-cached by the
 * provider, and a normal multi-query turn's tool results add tens of KB
 * more. At 256 KB a build question that ran its queries as instructed died
 * mid-stream on the reservation while the provider had billed ~40k tokens;
 * 512 KB keeps the reservation a real ceiling without refusing turns the
 * model can comfortably serve.
 */
export const EXPLORE_MAX_PROVIDER_INPUT_BOUND = 512_000;

/**
 * Tokens reserved for one attached image.
 *
 * Providers bill an image by its pixel dimensions, not its encoded size, and
 * cap the resolution they read; this covers a full-resolution screenshot at
 * the highest detail any configured model reads.
 */
export const EXPLORE_IMAGE_INPUT_BOUND = 6000;

/**
 * Replace image data with a placeholder and count the images.
 *
 * Serialized, a 1 MiB screenshot is millions of characters — as a byte array
 * or as base64 — and would wrongly exhaust the bound on its own. The prompt
 * carries image bytes as a typed array or as a base64 string on an image part.
 */
function redactImages(value: unknown, images: { count: number }): unknown {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    images.count += 1;
    return "";
  }
  if (Array.isArray(value))
    return value.map((item) => redactImages(item, images));
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value);
  const isBase64Image =
    entries.some(
      ([key, field]) =>
        key === "mediaType" &&
        typeof field === "string" &&
        field.startsWith("image/"),
    ) &&
    entries.some(
      ([key, field]) =>
        (key === "data" || key === "image") && typeof field === "string",
    );
  if (isBase64Image) images.count += 1;
  return Object.fromEntries(
    entries.map(([key, field]) => [
      key,
      typeof field === "string" &&
      isBase64Image &&
      (key === "data" || key === "image")
        ? ""
        : redactImages(field, images),
    ]),
  );
}

export function exploreProviderInputBound(params: {
  prompt: unknown;
  tools?: unknown;
  responseFormat?: unknown;
}) {
  // A token cannot consume less than one UTF-8 byte. Count the complete wire
  // prompt and schemas, then reserve additional space for provider framing
  // and for each image.
  const images = { count: 0 };
  const text = JSON.stringify({
    prompt: redactImages(params.prompt, images),
    tools: params.tools,
    responseFormat: params.responseFormat,
  });
  return (
    new TextEncoder().encode(text).byteLength +
    8192 +
    images.count * EXPLORE_IMAGE_INPUT_BOUND
  );
}
