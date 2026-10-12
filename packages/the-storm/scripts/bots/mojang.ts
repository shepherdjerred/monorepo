/**
 * Mojang profile lookups, so no bot ever wears a name a real player holds.
 * `GET https://api.mojang.com/users/profiles/minecraft/<name>` answers 200 with
 * a profile when the name is taken and 204 or 404 when it is free.
 */

const PROFILE_URL = "https://api.mojang.com/users/profiles/minecraft/";
const MAX_ATTEMPTS = 6;

export type NameStatus = "taken" | "free";

export type MojangOptions = {
  userAgent: string;
  /** Milliseconds to wait between lookups so a batch stays well under the limit. */
  paceMs: number;
};

export class MojangNames {
  private lastRequestAt = 0;

  constructor(private readonly options: MojangOptions) {}

  async status(name: string): Promise<NameStatus> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.pace();
      const response = await fetch(
        `${PROFILE_URL}${encodeURIComponent(name)}`,
        { headers: { "User-Agent": this.options.userAgent } },
      );
      this.lastRequestAt = Date.now();
      if (response.status === 200) {
        return "taken";
      }
      if (response.status === 204 || response.status === 404) {
        return "free";
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000 * 2 ** attempt;
        console.error(
          `mojang: ${String(response.status)} for ${name}; retrying in ${String(backoff)} ms`,
        );
        await Bun.sleep(backoff);
        continue;
      }
      throw new Error(
        `mojang: unexpected ${String(response.status)} for ${name}: ${await response.text()}`,
      );
    }
    throw new Error(
      `mojang: gave up on ${name} after ${String(MAX_ATTEMPTS)} attempts`,
    );
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + this.options.paceMs - Date.now();
    if (wait > 0) {
      await Bun.sleep(wait);
    }
  }
}
