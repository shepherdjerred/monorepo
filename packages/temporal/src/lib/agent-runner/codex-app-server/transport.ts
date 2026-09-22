import { z } from "zod/v4";

export const RpcMessageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type RpcMessage = z.infer<typeof RpcMessageSchema>;

const MAX_PROTOCOL_LINE_BYTES = 8 * 1024 * 1024;

export async function* readRpcMessages(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<RpcMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      buffered += decoder.decode(chunk.value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        if (newline > MAX_PROTOCOL_LINE_BYTES) {
          throw new Error("Codex App Server protocol line exceeds its bound");
        }
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line !== "") {
          const parsed: unknown = JSON.parse(line);
          yield RpcMessageSchema.parse(parsed);
        }
        newline = buffered.indexOf("\n");
      }
      if (buffered.length > MAX_PROTOCOL_LINE_BYTES) {
        throw new Error("Codex App Server protocol line exceeds its bound");
      }
      chunk = await reader.read();
    }
    buffered += decoder.decode();
    if (buffered.trim() !== "") {
      throw new Error(
        "Codex App Server closed with a partial protocol message",
      );
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function drainStderr(
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      // Never retain or publish provider stderr, which can contain credentials.
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
}
