import { z } from "zod/v4";

export const ReflectionTypeSchema = z.enum([
  "observation",
  "suggestion",
  "next_move",
  "scoring_update",
]);

export const NextMoveActionSchema = z.enum([
  "reveal_next_part",
  "give_hint",
  "ask_complexity",
  "wrap_up",
  "continue",
]);

export const NextMovePayloadSchema = z.object({
  action: NextMoveActionSchema,
  targetPart: z.number().int().optional(),
  condition: z.enum(["immediate", "after_response", "when_stuck"]),
});

export const ReflectionSchema = z.object({
  type: ReflectionTypeSchema,
  content: z.string(),
  priority: z.number().int().min(1).max(10),
  nextMove: NextMovePayloadSchema.optional(),
  createdAt: z.number(),
});

export type ReflectionType = z.infer<typeof ReflectionTypeSchema>;
export type NextMoveAction = z.infer<typeof NextMoveActionSchema>;
export type NextMovePayload = z.infer<typeof NextMovePayloadSchema>;
export type Reflection = z.infer<typeof ReflectionSchema>;

export type ReflectionQueue = {
  push: (reflection: Reflection) => void;
  drain: (maxCount: number) => Reflection[];
  peek: (maxCount: number) => Reflection[];
  size: () => number;
  clear: () => void;
};

export function createReflectionQueue(): ReflectionQueue {
  const queue: Reflection[] = [];

  function push(reflection: Reflection): void {
    queue.push(reflection);
    // Keep sorted by priority descending
    queue.sort((a, b) => b.priority - a.priority);
  }

  function drain(maxCount: number): Reflection[] {
    const count = Math.min(maxCount, queue.length);
    return queue.splice(0, count);
  }

  function peek(maxCount: number): Reflection[] {
    return queue.slice(0, maxCount);
  }

  function size(): number {
    return queue.length;
  }

  function clear(): void {
    queue.length = 0;
  }

  return { push, drain, peek, size, clear };
}
