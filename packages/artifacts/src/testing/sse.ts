export type SseEvent = { event: string; data: string; raw: string };

export type EventStream = {
  /** Reads until `until` holds over everything received so far, or time runs out. */
  waitFor: (
    until: (events: SseEvent[], raw: string) => boolean,
    timeoutMs?: number,
  ) => Promise<{ events: SseEvent[]; raw: string }>;
  cancel: () => Promise<void>;
};

function parseEvents(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split("\n\n")) {
    if (block.trim().length === 0 || block.startsWith(":")) continue;
    const event = /^event: (.*)$/mu.exec(block)?.[1];
    const data = /^data: (.*)$/mu.exec(block)?.[1];
    if (event !== undefined && data !== undefined)
      events.push({ event, data, raw: block });
  }
  return events;
}

async function expire(timeoutMs: number): Promise<null> {
  await Bun.sleep(timeoutMs);
  return null;
}

async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) {
  return Promise.race([reader.read(), expire(timeoutMs)]);
}

/** A Server-Sent Events response read incrementally across several waits. */
export function openEventStream(response: Response): EventStream {
  const body = response.body;
  if (body === null) throw new Error("no stream body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  return {
    async waitFor(until, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!until(parseEvents(raw), raw) && Date.now() < deadline) {
        const next = await nextChunk(
          reader,
          Math.max(1, deadline - Date.now()),
        );
        if (next === null || next.done) break;
        raw += decoder.decode(next.value, { stream: true });
      }
      return { events: parseEvents(raw), raw };
    },
    cancel: async () => {
      await reader.cancel();
    },
  };
}
