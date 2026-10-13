import type { InputRecord } from "@discord-plays-pokemon/common";

export type InputLogEntry = Omit<InputRecord, "id" | "at">;

/**
 * The most recent accepted commands, from every transport, for the web page's
 * "who pressed what" feed. Bounded: it is a live view, not an audit log.
 */
export class InputLog {
  private readonly capacity: number;
  private readonly entries: InputRecord[] = [];
  private readonly listeners = new Set<(entries: InputRecord[]) => void>();
  private nextId = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  record(entry: InputLogEntry, now: Date = new Date()): void {
    this.nextId += 1;
    this.entries.push({
      ...entry,
      id: String(this.nextId),
      at: now.toISOString(),
    });
    if (this.entries.length > this.capacity) this.entries.shift();
    const snapshot = this.recent();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** Oldest first. */
  recent(): InputRecord[] {
    return [...this.entries];
  }

  /** A new session must not inherit another guild's activity. */
  clear(): void {
    this.entries.length = 0;
    for (const listener of this.listeners) listener([]);
  }

  subscribe(listener: (entries: InputRecord[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
