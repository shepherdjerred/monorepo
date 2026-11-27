import { reportError } from "#infrastructure/log.ts";

/**
 * Passes a body through unchanged but reports a failure of the stream (an
 * object store read that breaks, an `HTMLRewriter` error) as a structured
 * line naming the version. The URL and token are never logged.
 */
export function watchStream(
  stream: ReadableStream<Uint8Array>,
  fields: { versionId: string; op: string },
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        reportError(error, "artifacts_content_stream_failed", fields);
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
