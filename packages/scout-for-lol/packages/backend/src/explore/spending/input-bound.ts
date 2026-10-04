/** A conservative token bound, including provider framing overhead. */
export const EXPLORE_MAX_PROVIDER_INPUT_BOUND = 256_000;

export function exploreProviderInputBound(params: {
  prompt: unknown;
  tools?: unknown;
  responseFormat?: unknown;
}) {
  // A token cannot consume less than one UTF-8 byte. Count the complete wire
  // prompt and schemas, then reserve additional space for provider framing.
  return (
    new TextEncoder().encode(
      JSON.stringify({
        prompt: params.prompt,
        tools: params.tools,
        responseFormat: params.responseFormat,
      }),
    ).byteLength + 8192
  );
}
