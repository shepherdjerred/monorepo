import { describe, expect, it } from "vitest";
import type { AskJudge } from "#build/judge.ts";
import type { PairCache } from "#evals/bench/lib/entries.ts";
import {
  runTournament,
  schedulePairs,
  type Contestant,
} from "#evals/bench/lib/tournament.ts";

function contestant(id: string, byte: number): Contestant {
  return {
    id,
    sha256: `sha-${byte.toString()}`,
    image: { data: new Uint8Array([byte]), mediaType: "image/jpeg" },
  };
}

/** Prefers the lower first byte, in either order; counts its calls. */
function counting(): { ask: AskJudge; calls: () => number } {
  let calls = 0;
  const ask: AskJudge = (first, second) => {
    calls += 1;
    return Promise.resolve({
      winner: (first.data[0] ?? 0) < (second.data[0] ?? 0) ? "first" : "second",
      confidence: 0.9,
      reasons: ["lower byte"],
    });
  };
  return { ask, calls: () => calls };
}

describe("tournament", () => {
  it("schedules every unordered pair once", () => {
    expect(schedulePairs(["a", "b", "c", "d"])).toHaveLength(6);
    expect(schedulePairs(["a"])).toEqual([]);
  });

  it("judges each pair in both orders and reuses the cache, flipped when needed", async () => {
    const [x, y, z] = [
      contestant("x", 1),
      contestant("y", 2),
      contestant("z", 3),
    ];
    const first = counting();
    const run = await runTournament([x, y, z], {
      ask: first.ask,
      model: "stub",
      rubric: "micro",
      cache: {},
    });
    expect(run.judged).toBe(3);
    expect(first.calls()).toBe(6);
    expect(
      run.pairs.map((pair) => `${pair.a}>${pair.b}:${pair.winner}`),
    ).toEqual(["x>y:a", "x>z:a", "y>z:a"]);

    // Reversed order of contestants: every verdict comes from the cache and
    // is flipped to match the new a/b assignment.
    const second = counting();
    const again = await runTournament([z, y, x], {
      ask: second.ask,
      model: "stub",
      rubric: "micro",
      cache: run.cache,
    });
    expect(again.judged).toBe(0);
    expect(second.calls()).toBe(0);
    expect(
      again.pairs.map((pair) => `${pair.a}>${pair.b}:${pair.winner}`),
    ).toEqual(["z>y:b", "z>x:b", "y>x:b"]);

    // A different model is a different cache key.
    const third = counting();
    const other = await runTournament([x, y], {
      ask: third.ask,
      model: "other",
      rubric: "micro",
      cache: run.cache,
    });
    expect(other.judged).toBe(1);
  });

  it("persists the cache after every judged pair, so a failed call keeps the earlier verdicts", async () => {
    const [x, y, z] = [
      contestant("x", 1),
      contestant("y", 2),
      contestant("z", 3),
    ];
    const good = counting();
    let pairs = 0;
    const ask: AskJudge = (first, second) => {
      // Every pair is asked twice (order-swapped); the second pair's first call fails.
      pairs += 1;
      return pairs === 3
        ? Promise.reject(new Error("provider down"))
        : good.ask(first, second);
    };
    const persisted: PairCache[] = [];
    await expect(
      runTournament([x, y, z], {
        ask,
        model: "stub",
        rubric: "micro",
        cache: {},
        persist: (cache) => {
          persisted.push(structuredClone(cache));
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow(/provider down/u);
    expect(persisted).toHaveLength(1);
    const saved = persisted[0] ?? {};
    expect(Object.keys(saved)).toHaveLength(1);

    // Resuming from what was saved pays only for the pairs never judged.
    const resumed = counting();
    const run = await runTournament([x, y, z], {
      ask: resumed.ask,
      model: "stub",
      rubric: "micro",
      cache: saved,
    });
    expect(run.judged).toBe(2);
    expect(resumed.calls()).toBe(4);
  });
});
