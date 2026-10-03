import { nonce } from "./session-store.ts";
import { WebError } from "./errors.ts";

/** Bounded, short-lived server-owned references; clients cannot submit paths or track refs. */
export class Selections<T> {
  private readonly owners = new Map<
    string,
    { items: Map<string, { value: T; expires: number }>; expires: number }
  >();
  constructor(private readonly lifetimeMs = 10 * 60 * 1000) {}

  add(owner: string, value: T, now = Date.now()): string {
    for (const [key, bucket] of this.owners) {
      if (bucket.expires <= now) this.owners.delete(key);
    }
    let bucket = this.owners.get(owner);
    if (bucket === undefined) {
      if (this.owners.size >= 2000)
        throw new WebError(
          429,
          "selection_capacity",
          "Media selections are busy. Try again shortly.",
        );
      bucket = { items: new Map(), expires: now + this.lifetimeMs };
      this.owners.set(owner, bucket);
    }
    for (const [key, item] of bucket.items) {
      if (item.expires <= now) bucket.items.delete(key);
    }
    if (bucket.items.size >= 200) {
      const first = bucket.items.keys().next().value;
      if (first !== undefined) bucket.items.delete(first);
    }
    const token = nonce();
    bucket.expires = now + this.lifetimeMs;
    bucket.items.set(token, { value, expires: bucket.expires });
    return token;
  }

  get(owner: string, token: string, now = Date.now()): T {
    const item = this.owners.get(owner)?.items.get(token);
    if (item === undefined || item.expires <= now) {
      throw new WebError(
        409,
        "selection_expired",
        "This selection expired. Refresh and select it again.",
      );
    }
    return item.value;
  }
}
