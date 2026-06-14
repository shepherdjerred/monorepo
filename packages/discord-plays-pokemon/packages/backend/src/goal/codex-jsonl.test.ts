import { describe, expect, test } from "bun:test";
import { createCodexJsonlParser, type CodexEvent } from "./codex-jsonl.ts";

function collect(): {
  events: CodexEvent[];
  listener: (e: CodexEvent) => void;
} {
  const events: CodexEvent[] = [];
  return { events, listener: (e) => events.push(e) };
}

const TURN_STARTED = `{"type":"turn.started"}`;
const AGENT_MSG = `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}`;
const OTHER_ITEM = `{"type":"item.completed","item":{"type":"reasoning","text":"..."}}`;
const TURN_COMPLETED = `{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":900,"output_tokens":50,"reasoning_output_tokens":25}}`;

describe("createCodexJsonlParser", () => {
  test("emits turn.started → agent_message → turn.completed in order", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    parser.subscribe(listener);

    parser.push(`${TURN_STARTED}\n${AGENT_MSG}\n${TURN_COMPLETED}\n`);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["turn.started", "agent_message", "turn.completed"]);
  });

  test("accumulates usage across many turns", () => {
    const parser = createCodexJsonlParser();
    parser.push(`${TURN_COMPLETED}\n`);
    parser.push(`${TURN_COMPLETED}\n`);
    parser.push(`${TURN_COMPLETED}\n`);

    expect(parser.total()).toEqual({
      inputTokens: 3000,
      cachedInputTokens: 2700,
      outputTokens: 150,
      reasoningOutputTokens: 75,
    });
  });

  test("emits other-typed item.completed as `other` (not agent_message)", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    parser.subscribe(listener);

    parser.push(`${OTHER_ITEM}\n`);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("other");
  });

  test("handles chunks split mid-line", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    parser.subscribe(listener);

    const full = `${TURN_STARTED}\n${AGENT_MSG}\n${TURN_COMPLETED}\n`;
    // Split into 11-char chunks to torture-test the buffer.
    for (let i = 0; i < full.length; i += 11) {
      parser.push(full.slice(i, i + 11));
    }

    expect(events.map((e) => e.kind)).toEqual([
      "turn.started",
      "agent_message",
      "turn.completed",
    ]);
  });

  test("emits parse_error for malformed lines without crashing the stream", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    parser.subscribe(listener);

    parser.push(`not json at all\n${TURN_COMPLETED}\n`);

    expect(events.map((e) => e.kind)).toEqual([
      "parse_error",
      "turn.completed",
    ]);
    expect(parser.total().inputTokens).toBe(1000);
  });

  test("finish() flushes a trailing line with no newline", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    parser.subscribe(listener);

    parser.push(TURN_COMPLETED); // no trailing newline
    parser.finish();

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("turn.completed");
  });

  test("unsubscribe stops delivery of further events", () => {
    const { events, listener } = collect();
    const parser = createCodexJsonlParser();
    const unsubscribe = parser.subscribe(listener);

    parser.push(`${TURN_STARTED}\n`);
    unsubscribe();
    parser.push(`${TURN_COMPLETED}\n`);

    expect(events.map((e) => e.kind)).toEqual(["turn.started"]);
  });

  test("treats missing usage fields as zero (defensive against schema drift)", () => {
    const parser = createCodexJsonlParser();
    parser.push(`{"type":"turn.completed","usage":{"input_tokens":42}}\n`);

    expect(parser.total()).toEqual({
      inputTokens: 42,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  test("a listener that throws does not block other listeners", () => {
    const parser = createCodexJsonlParser();
    const seen: string[] = [];
    parser.subscribe(() => {
      throw new Error("boom");
    });
    parser.subscribe((e) => seen.push(e.kind));

    parser.push(`${TURN_STARTED}\n`);

    expect(seen).toEqual(["turn.started"]);
  });
});
