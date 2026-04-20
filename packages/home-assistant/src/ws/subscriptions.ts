import type { EventEnvelope } from "./messages.ts";

export type EventHandler = (event: EventEnvelope) => void | Promise<void>;

export type Subscription =
  | {
      kind: "event";
      eventType: string;
      handler: EventHandler;
    }
  | {
      kind: "trigger";
      trigger: Record<string, unknown>;
      handler: EventHandler;
    };

export class SubscriptionRegistry {
  private readonly entries = new Map<number, Subscription>();

  public set(id: number, subscription: Subscription): void {
    this.entries.set(id, subscription);
  }

  public delete(id: number): Subscription | undefined {
    const existing = this.entries.get(id);
    this.entries.delete(id);
    return existing;
  }

  public get(id: number): Subscription | undefined {
    return this.entries.get(id);
  }

  public clear(): void {
    this.entries.clear();
  }

  public snapshot(): [number, Subscription][] {
    return [...this.entries.entries()];
  }
}
