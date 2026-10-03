import { nonce } from "./session-store.ts";
import { WebError } from "./errors.ts";

/** Bounded, short-lived server-owned references; clients cannot submit paths or track refs. */
export class Selections<T> {
  private readonly items = new Map<
    string,
    { owner: string; value: T; expires: number }
  >();
  constructor(private readonly lifetimeMs = 10 * 60 * 1000) {}

  add(owner: string, value: T, now = Date.now()): string {
    for (const [key, item] of this.items) {
      if (item.expires <= now) this.items.delete(key);
    }
    if (this.items.size >= 2000) {
      const first = this.items.keys().next().value;
      if (first !== undefined) this.items.delete(first);
    }
    const token = nonce();
    this.items.set(token, { owner, value, expires: now + this.lifetimeMs });
    return token;
  }

  get(owner: string, token: string, now = Date.now()): T {
    const item = this.items.get(token);
    if (item?.owner !== owner || item.expires <= now) {
      throw new WebError(
        409,
        "selection_expired",
        "This selection expired. Refresh and select it again.",
      );
    }
    return item.value;
  }
}
