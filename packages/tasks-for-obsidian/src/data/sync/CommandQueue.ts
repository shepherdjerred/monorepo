import { z } from "zod";

import { TypedStorage } from "../cache/storage";
import type { AppError } from "../../domain/errors";
import type { TaskId } from "../../domain/types";
import {
  type Command,
  CommandSchema,
  commandTarget,
  remapTaskId,
} from "./commands";

/**
 * Durable FIFO command queue — persistence only, no execution.
 *
 * Separating storage from execution (which lives in SyncEngine) is what makes
 * single-flight replay possible: the old MutationQueue owned both, so two
 * callers could `replay()` the same snapshot concurrently and double-execute.
 */

export type CommandQueueStorage = {
  readQueue: () => Promise<string | null>;
  writeQueue: (data: string) => Promise<void>;
  readDeadLetter: () => Promise<string | null>;
  writeDeadLetter: (data: string) => Promise<void>;
};

const defaultStorage: CommandQueueStorage = {
  readQueue: () => TypedStorage.getQueueV2(),
  writeQueue: (data) => TypedStorage.setQueueV2(data),
  readDeadLetter: () => TypedStorage.getDeadLetter(),
  writeDeadLetter: (data) => TypedStorage.setDeadLetter(data),
};

export type DeadLetterEntry = {
  readonly command: Command;
  readonly error: {
    name: string;
    message: string;
    status?: number | undefined;
  };
  readonly failedAt: number;
};

const DeadLetterSchema = z.object({
  command: CommandSchema,
  error: z.object({
    name: z.string(),
    message: z.string(),
    status: z.number().optional(),
  }),
  failedAt: z.number(),
});

function serializeError(error: AppError): DeadLetterEntry["error"] {
  const base = { name: error.name, message: error.message };
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return { ...base, status: error.statusCode };
  }
  return base;
}

export class CommandQueue {
  private queue: Command[] = [];
  private dead: DeadLetterEntry[] = [];

  constructor(
    private readonly storage: CommandQueueStorage = defaultStorage,
    private readonly clock: () => number = Date.now,
  ) {}

  async restore(): Promise<void> {
    this.queue = await this.load(this.storage.readQueue(), (item) =>
      CommandSchema.safeParse(item),
    );
    this.dead = await this.load(this.storage.readDeadLetter(), (item) =>
      DeadLetterSchema.safeParse(item),
    );
  }

  private async load<T>(
    read: Promise<string | null>,
    parse: (item: unknown) => { success: true; data: T } | { success: false },
  ): Promise<T[]> {
    const raw = await read;
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: T[] = [];
      for (const item of parsed) {
        const result = parse(item);
        if (result.success) out.push(result.data);
      }
      return out;
    } catch {
      return [];
    }
  }

  get pending(): readonly Command[] {
    return this.queue;
  }

  get deadLetters(): readonly DeadLetterEntry[] {
    return this.dead;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  head(): Command | undefined {
    return this.queue[0];
  }

  async enqueue(command: Command): Promise<void> {
    // Squash: a delete of a still-pending offline-created task (temp id) means
    // the task was created and destroyed before ever reaching the server —
    // drop the create and every command targeting it, and skip the delete.
    if (command.type === "delete") {
      const target = command.taskId;
      const hasPendingCreate = this.queue.some(
        (c) => c.type === "create" && c.tempId === target,
      );
      if (hasPendingCreate) {
        this.queue = this.queue.filter((c) => commandTarget(c) !== target);
        await this.persistQueue();
        return;
      }
    }
    this.queue.push(command);
    await this.persistQueue();
  }

  async ack(id: string): Promise<void> {
    this.queue = this.queue.filter((c) => c.id !== id);
    await this.persistQueue();
  }

  async remapTaskId(from: TaskId, to: TaskId): Promise<void> {
    this.queue = this.queue.map((c) => remapTaskId(c, from, to));
    await this.persistQueue();
    // Dead-lettered downstream commands can still target the temp id: if a
    // create and a following command (e.g. set_status) both dead-letter, then
    // the create is retried and acked with a real id, the set_status entry
    // stays pinned to the now-dead temp id and fails every subsequent retry.
    // Remap the dead-letter list too so a later retry targets the real id.
    const prevDead = this.dead;
    this.dead = prevDead.map((entry) => {
      const command = remapTaskId(entry.command, from, to);
      return command === entry.command ? entry : { ...entry, command };
    });
    if (this.dead.some((entry, i) => entry !== prevDead[i])) {
      await this.persistDeadLetter();
    }
  }

  async deadLetter(id: string, error: AppError): Promise<void> {
    const command = this.queue.find((c) => c.id === id);
    if (command === undefined) return;
    this.queue = this.queue.filter((c) => c.id !== id);
    this.dead.push({
      command,
      error: serializeError(error),
      failedAt: this.clock(),
    });
    await this.persistQueue();
    await this.persistDeadLetter();
  }

  async retryDeadLetter(id: string): Promise<void> {
    const entry = this.dead.find((d) => d.command.id === id);
    if (entry === undefined) return;
    this.dead = this.dead.filter((d) => d.command.id !== id);
    this.queue.push(entry.command);
    await this.persistQueue();
    await this.persistDeadLetter();
  }

  async discardDeadLetter(id: string): Promise<void> {
    this.dead = this.dead.filter((d) => d.command.id !== id);
    await this.persistDeadLetter();
  }

  private async persistQueue(): Promise<void> {
    await this.storage.writeQueue(JSON.stringify(this.queue));
  }

  private async persistDeadLetter(): Promise<void> {
    await this.storage.writeDeadLetter(JSON.stringify(this.dead));
  }
}
