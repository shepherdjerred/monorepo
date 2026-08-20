import { describe, expect, test } from "bun:test";
import {
  EXPLORE_RUN_MARKERS_KEY,
  clearSettledExploreRunMarker,
  createExploreRunMarker,
  loadExploreRunMarkers,
  saveExploreRunMarkers,
  setExploreRunMarker,
  type ExploreRunMarker,
} from "#src/lib/explore-run-markers.ts";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

function marker(state: ExploreRunMarker["state"]): ExploreRunMarker {
  return {
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    questionMessageId: QUESTION_ID,
    leafIdAtStart: null,
    state,
  };
}

describe("Explore run markers", () => {
  test("persist only opaque ids and unread state", () => {
    const storage = new MemoryStorage();
    saveExploreRunMarkers(storage, [marker("running")]);

    expect(loadExploreRunMarkers(storage)).toEqual([marker("running")]);
    const raw = storage.getItem(EXPLORE_RUN_MARKERS_KEY) ?? "";
    expect(raw).toContain(RUN_ID);
    expect(raw).not.toContain("prompt");
    expect(raw).not.toContain("answer");
    expect(raw).not.toContain("trace");
  });

  test("projects active summaries onto the strict local marker shape", () => {
    const summary = {
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      questionMessageId: QUESTION_ID,
      leafIdAtStart: null,
      startedAt: "2026-08-20T00:00:00.000Z",
    };
    expect(createExploreRunMarker(summary, "running")).toEqual(
      marker("running"),
    );
  });

  test("invalid or stale storage versions are ignored", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      EXPLORE_RUN_MARKERS_KEY,
      JSON.stringify({ version: 2, markers: [marker("completed")] }),
    );
    expect(loadExploreRunMarkers(storage)).toEqual([]);
  });

  test("updates one conversation without duplicating it", () => {
    const running = setExploreRunMarker([], marker("running"));
    const completed = setExploreRunMarker(running, marker("completed"));

    expect(completed).toEqual([marker("completed")]);
    expect(setExploreRunMarker(completed, marker("completed"))).toBe(completed);
  });

  test("opening a conversation clears settled markers but keeps running ones", () => {
    expect(
      clearSettledExploreRunMarker([marker("completed")], CONVERSATION_ID),
    ).toEqual([]);
    expect(
      clearSettledExploreRunMarker([marker("running")], CONVERSATION_ID),
    ).toEqual([marker("running")]);
  });

  test("prunes the oldest settled markers before live markers", () => {
    const settled = Array.from({ length: 100 }, (_, index) => ({
      ...marker("completed"),
      conversationId: `22222222-2222-4222-8222-${index
        .toString()
        .padStart(12, "0")}`,
    }));
    const live = {
      ...marker("running"),
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const retained = setExploreRunMarker(settled, live);

    expect(retained).toHaveLength(100);
    expect(retained).toContainEqual(live);
    expect(retained).not.toContainEqual(settled[0]);

    const storage = new MemoryStorage();
    expect(() =>
      saveExploreRunMarkers(storage, [...settled, live]),
    ).not.toThrow();
    expect(loadExploreRunMarkers(storage)).toEqual(retained);
  });
});
