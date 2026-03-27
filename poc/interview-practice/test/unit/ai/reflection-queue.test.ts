import { describe, test, expect } from "bun:test";
import {
  createReflectionQueue,
  type Reflection,
} from "#lib/ai/reflection-queue.ts";

function makeReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    type: "observation",
    content: "test reflection",
    priority: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("ReflectionQueue", () => {
  test("starts empty", () => {
    const queue = createReflectionQueue();
    expect(queue.size()).toBe(0);
    expect(queue.drain(5)).toEqual([]);
    expect(queue.peek(5)).toEqual([]);
  });

  test("push adds items and sorts by priority descending", () => {
    const queue = createReflectionQueue();
    queue.push(makeReflection({ priority: 3, content: "low" }));
    queue.push(makeReflection({ priority: 9, content: "high" }));
    queue.push(makeReflection({ priority: 5, content: "mid" }));

    const peeked = queue.peek(3);
    expect(peeked).toHaveLength(3);
    expect(peeked[0]?.content).toBe("high");
    expect(peeked[1]?.content).toBe("mid");
    expect(peeked[2]?.content).toBe("low");
  });

  test("drain removes items from the queue", () => {
    const queue = createReflectionQueue();
    queue.push(makeReflection({ priority: 1 }));
    queue.push(makeReflection({ priority: 2 }));
    queue.push(makeReflection({ priority: 3 }));

    const drained = queue.drain(2);
    expect(drained).toHaveLength(2);
    expect(queue.size()).toBe(1);
  });

  test("drain returns at most maxCount items", () => {
    const queue = createReflectionQueue();
    queue.push(makeReflection());

    const drained = queue.drain(5);
    expect(drained).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  test("peek does not remove items", () => {
    const queue = createReflectionQueue();
    queue.push(makeReflection());
    queue.push(makeReflection());

    const peeked = queue.peek(1);
    expect(peeked).toHaveLength(1);
    expect(queue.size()).toBe(2);
  });

  test("clear removes all items", () => {
    const queue = createReflectionQueue();
    queue.push(makeReflection());
    queue.push(makeReflection());
    queue.push(makeReflection());

    queue.clear();
    expect(queue.size()).toBe(0);
  });

  test("handles next_move reflections", () => {
    const queue = createReflectionQueue();
    queue.push(
      makeReflection({
        type: "next_move",
        priority: 9,
        content: "Ready for part 2",
        nextMove: {
          action: "reveal_next_part",
          targetPart: 2,
          condition: "immediate",
        },
      }),
    );

    const drained = queue.drain(1);
    expect(drained).toHaveLength(1);
    expect(drained[0]?.type).toBe("next_move");
    expect(drained[0]?.nextMove?.action).toBe("reveal_next_part");
    expect(drained[0]?.nextMove?.targetPart).toBe(2);
    expect(drained[0]?.nextMove?.condition).toBe("immediate");
  });
});
