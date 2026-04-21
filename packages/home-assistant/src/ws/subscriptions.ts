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

/**
 * Tracks subscriptions with two independent identifiers:
 *
 * - `clientKey`: stable for the lifetime of the caller-facing subscription,
 *   generated on registration. Closures returned by subscribe* capture this
 *   key so they still resolve to the right subscription after a reconnect
 *   assigns a new server-side id.
 * - `serverId`: the HA-assigned numeric id the server uses in event and
 *   result messages. Rebound on every (re)subscribe.
 */
export class SubscriptionRegistry {
  private readonly byClientKey = new Map<number, Subscription>();
  private readonly clientKeyToServerId = new Map<number, number>();
  private readonly serverIdToClientKey = new Map<number, number>();
  private nextClientKey = 1;

  public register(subscription: Subscription): number {
    const clientKey = this.nextClientKey;
    this.nextClientKey += 1;
    this.byClientKey.set(clientKey, subscription);
    return clientKey;
  }

  public bindServerId(clientKey: number, serverId: number): void {
    const previous = this.clientKeyToServerId.get(clientKey);
    if (previous !== undefined) {
      this.serverIdToClientKey.delete(previous);
    }
    this.clientKeyToServerId.set(clientKey, serverId);
    this.serverIdToClientKey.set(serverId, clientKey);
  }

  public unregister(clientKey: number):
    | {
        subscription: Subscription;
        serverId: number | undefined;
      }
    | undefined {
    const subscription = this.byClientKey.get(clientKey);
    if (subscription === undefined) {
      return undefined;
    }
    this.byClientKey.delete(clientKey);
    const serverId = this.clientKeyToServerId.get(clientKey);
    this.clientKeyToServerId.delete(clientKey);
    if (serverId !== undefined) {
      this.serverIdToClientKey.delete(serverId);
    }
    return { subscription, serverId };
  }

  public getByServerId(serverId: number): Subscription | undefined {
    const clientKey = this.serverIdToClientKey.get(serverId);
    if (clientKey === undefined) {
      return undefined;
    }
    return this.byClientKey.get(clientKey);
  }

  public clearServerIds(): void {
    this.clientKeyToServerId.clear();
    this.serverIdToClientKey.clear();
  }

  public snapshot(): [number, Subscription][] {
    return [...this.byClientKey.entries()];
  }
}
