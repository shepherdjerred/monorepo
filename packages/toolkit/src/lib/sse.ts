/**
 * Minimal `text/event-stream` reader shared by the Forum and incident
 * watchers: it yields each frame's joined `data:` lines and ignores comments,
 * `event:`, `id:`, and `retry:` fields.
 */
function consumeSseLine(line: string, dataLines: string[]): string | undefined {
  if (line === "") {
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join("\n");
    dataLines.length = 0;
    return payload;
  }
  if (line.startsWith(":")) return undefined;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  if (field !== "data") return undefined;
  const rawValue = colon === -1 ? "" : line.slice(colon + 1);
  dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
  return undefined;
}

export type SseReadOptions = {
  /** Called once, when the first bytes (usually the server's `: connected` comment) arrive. */
  readonly onFirstChunk?: () => void;
};

/**
 * Read frames until `onFrame` returns true (resolves true) or the stream ends
 * (resolves false). The reader is cancelled on every exit path.
 */
export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (data: string) => Promise<boolean>,
  options: SseReadOptions = {},
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const dataLines: string[] = [];
  let buffer = "";
  let first = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (first) {
        first = false;
        options.onFirstChunk?.();
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const payload = consumeSseLine(line, dataLines);
        if (payload !== undefined && (await onFrame(payload))) return true;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      /* Stream cleanup on exit or abort is best-effort. */
    });
  }
}
