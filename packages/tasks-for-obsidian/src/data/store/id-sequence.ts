import { z } from "zod";

import type { Task, TaskId } from "../../domain/types";
import type { CommandQueue } from "../sync/CommandQueue";
import { commandId, tempTaskId } from "../sync/commands";

const IdCountersSchema = z.object({
  command: z.number().int().nonnegative(),
  temp: z.number().int().nonnegative(),
});

type IdCounters = z.infer<typeof IdCountersSchema>;

const ZERO_COUNTERS: IdCounters = { command: 0, temp: 0 };

/**
 * Owns the durable command-id and temp-id sequences.
 *
 * Keeping both counters together ensures they are serialized from the same
 * state after a command is built. The store remains responsible for writing
 * that state before it writes the command carrying the generated ids.
 */
export class IdSequence {
  private counters: IdCounters = ZERO_COUNTERS;

  constructor(private readonly random: () => number) {}

  /**
   * Absent or unreadable counters mean "start at zero" — a fresh install, and
   * also every install that predates the key. Neither needs a schema migration:
   * the collision checks below refuse to return an id the restored queue
   * already holds, so a carried-over queue is safe on that first launch too.
   */
  restore(raw: string | null): void {
    this.counters = parseIdCounters(raw);
  }

  serialize(): string {
    return JSON.stringify(this.counters);
  }

  /**
   * Mint a command id no durable command already carries.
   *
   * The persisted counter removes the collision class: it never restarts, so
   * the same `(millis, counter)` pair is never offered twice. The queue check
   * covers the first launch after upgrading from a build without counters and
   * a counter blob that failed to parse.
   *
   * The loop terminates because the counter strictly increases while the
   * durable command set is finite.
   */
  nextCommandId(createdAt: number, queue: CommandQueue): string {
    for (;;) {
      this.counters = { ...this.counters, command: this.counters.command + 1 };
      const candidate = commandId(
        createdAt,
        this.counters.command,
        this.random(),
      );
      if (!queue.hasCommandId(candidate)) return candidate;
    }
  }

  /** Mint a temp id neither the cached base nor any durable command claims. */
  nextTempId(
    createdAt: number,
    base: ReadonlyMap<TaskId, Task>,
    queue: CommandQueue,
  ): TaskId {
    for (;;) {
      this.counters = { ...this.counters, temp: this.counters.temp + 1 };
      const candidate = tempTaskId(createdAt, this.counters.temp);
      if (!base.has(candidate) && !queue.hasTarget(candidate)) return candidate;
    }
  }
}

function parseIdCounters(raw: string | null): IdCounters {
  if (!raw) return ZERO_COUNTERS;
  try {
    const parsed = IdCountersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : ZERO_COUNTERS;
  } catch {
    return ZERO_COUNTERS;
  }
}
