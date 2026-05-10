import { z } from "zod";
import { ManifestSchema, type Manifest } from "#src/parser/manifest";

const IDENTIFIER = "content";
const TIMESTAMP = IDENTIFIER + "-timestamp";

export class LocalStorageManifestDatastore {
  set(manifest: Manifest): void {
    globalThis.localStorage.setItem(IDENTIFIER, JSON.stringify(manifest));
    this.setTime(new Date());
  }

  get(): Manifest | undefined {
    const stored = globalThis.localStorage.getItem(IDENTIFIER);
    if (stored === null) {
      return undefined;
    }
    const raw: unknown = JSON.parse(stored);
    return ManifestSchema.parse(raw);
  }

  isStale(): boolean {
    const timestamp = globalThis.localStorage.getItem(TIMESTAMP);
    if (timestamp === null) {
      return true;
    }
    const storedTime = z.number().parse(JSON.parse(timestamp));
    const fifteenMinutes = 15 * 60 * 1000;
    return Date.now() - storedTime > fifteenMinutes;
  }

  private setTime(date: Date): void {
    globalThis.localStorage.setItem(TIMESTAMP, JSON.stringify(date.valueOf()));
  }
}
