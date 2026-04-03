const CSRF_TOKEN = process.env["CSRF_TOKEN"]!;
const LEETCODE_SESSION = process.env["LEETCODE_SESSION"]!;

if (!CSRF_TOKEN || !LEETCODE_SESSION) {
  console.error("Missing CSRF_TOKEN or LEETCODE_SESSION in .env");
  process.exit(1);
}

const COOKIES = `csrftoken=${CSRF_TOKEN}; LEETCODE_SESSION=${LEETCODE_SESSION}`;

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Cookie: COOKIES,
  "x-csrftoken": CSRF_TOKEN,
  Origin: "https://leetcode.com",
  Referer: "https://leetcode.com/problemset/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.133 Safari/537.36",
  "sec-ch-ua":
    '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

export interface QueryResult<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class LeetCodeClient {
  private lastRequestTime = 0;

  constructor(
    private minDelay: number = 2000,
    private maxDelay: number = 5000,
  ) {}

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const delay =
      this.minDelay + Math.random() * (this.maxDelay - this.minDelay);
    const remaining = delay - elapsed;
    if (remaining > 0) {
      await Bun.sleep(remaining);
    }
    this.lastRequestTime = Date.now();
  }

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    maxRetries: number = 3,
  ): Promise<QueryResult<T>> {
    await this.rateLimit();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let resp: Response;
      try {
        resp = await fetch("https://leetcode.com/graphql/", {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          const backoff = 10_000 * (attempt + 1);
          console.error(
            `  [network error] ${msg} — retrying in ${backoff / 1000}s`,
          );
          await Bun.sleep(backoff);
          continue;
        }
        throw new Error(
          `Network error after ${maxRetries + 1} attempts: ${msg}`,
        );
      }

      if (resp.status === 200) {
        const json = (await resp.json()) as QueryResult<T>;
        return json;
      }

      if (resp.status === 429) {
        const backoff = Math.min(30_000 * 2 ** attempt, 300_000);
        console.error(
          `  [429] Rate limited — backing off ${backoff / 1000}s (attempt ${attempt + 1})`,
        );
        await Bun.sleep(backoff);
        continue;
      }

      if (resp.status === 403) {
        const body = await resp.text().catch(() => "");
        throw new CloudflareBlockError(
          `403 Forbidden — likely Cloudflare block. Response: ${body.substring(0, 200)}`,
        );
      }

      if (resp.status >= 500) {
        if (attempt < maxRetries) {
          const backoff = 10_000 * (attempt + 1);
          console.error(
            `  [${resp.status}] Server error — retrying in ${backoff / 1000}s`,
          );
          await Bun.sleep(backoff);
          continue;
        }
        const body = await resp.text().catch(() => "");
        throw new Error(
          `Server error ${resp.status} after ${maxRetries + 1} attempts: ${body.substring(0, 200)}`,
        );
      }

      const body = await resp.text().catch(() => "");
      throw new Error(
        `Unexpected status ${resp.status}: ${body.substring(0, 200)}`,
      );
    }

    throw new Error("Exhausted retries");
  }
}

export class CloudflareBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareBlockError";
  }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

export function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
