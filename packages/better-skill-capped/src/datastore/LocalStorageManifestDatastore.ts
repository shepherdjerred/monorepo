import { Manifest } from "../parser/Manifest";

const IDENTIFIER = "content";
const TIMESTAMP = IDENTIFIER + "-timestamp";

export class LocalStorageManifestDatastore {
  set(manifest: Manifest): void {
    window.localStorage.setItem(IDENTIFIER, JSON.stringify(manifest));
    this.setTime(new Date());
  }

  get(): Manifest | undefined {
    const stored = window.localStorage.getItem(IDENTIFIER);
    if (stored) {
      return JSON.parse(stored) as Manifest;
    } else {
      return undefined;
    }
  }

  isStale(): boolean {
    const timestamp = window.localStorage.getItem(TIMESTAMP);
    if (!timestamp) {
      return true;
    }
    const storedTime = JSON.parse(timestamp) as number;
    const fifteenMinutes = 15 * 60 * 1000;
    return Date.now() - storedTime > fifteenMinutes;
  }

  private setTime(date: Date): void {
    window.localStorage.setItem(TIMESTAMP, JSON.stringify(date.valueOf()));
  }
}
