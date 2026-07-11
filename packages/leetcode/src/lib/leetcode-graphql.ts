const CSRF_TOKEN = Bun.env["CSRF_TOKEN"];
const LEETCODE_SESSION = Bun.env["LEETCODE_SESSION"];

if (
  CSRF_TOKEN == null ||
  CSRF_TOKEN === "" ||
  LEETCODE_SESSION == null ||
  LEETCODE_SESSION === ""
) {
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

import { z } from "zod";

const QueryResultSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

export type QueryResult = z.infer<typeof QueryResultSchema>;

export class LeetCodeClient {
  private lastRequestTime = 0;

  constructor(
    private readonly minDelay = 2000,
    private readonly maxDelay = 5000,
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

  async query(
    query: string,
    variables?: Record<string, unknown>,
    maxRetries = 3,
  ): Promise<QueryResult> {
    await this.rateLimit();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let resp: Response;
      try {
        resp = await fetch("https://leetcode.com/graphql/", {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ query, variables }),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < maxRetries) {
          const backoff = 10_000 * (attempt + 1);
          console.error(
            `  [network error] ${msg} — retrying in ${String(backoff / 1000)}s`,
          );
          await Bun.sleep(backoff);
          continue;
        }
        throw new Error(
          `Network error after ${String(maxRetries + 1)} attempts: ${msg}`,
          { cause: error },
        );
      }

      if (resp.status === 200) {
        return QueryResultSchema.parse(await resp.json());
      }

      if (resp.status === 429) {
        const backoff = Math.min(30_000 * 2 ** attempt, 300_000);
        console.error(
          `  [429] Rate limited — backing off ${String(backoff / 1000)}s (attempt ${String(attempt + 1)})`,
        );
        await Bun.sleep(backoff);
        continue;
      }

      if (resp.status === 403) {
        const body = await resp.text().catch(() => "");
        throw new CloudflareBlockError(
          `403 Forbidden — likely Cloudflare block. Response: ${body.slice(0, 200)}`,
        );
      }

      if (resp.status >= 500) {
        if (attempt < maxRetries) {
          const backoff = 10_000 * (attempt + 1);
          console.error(
            `  [${String(resp.status)}] Server error — retrying in ${String(backoff / 1000)}s`,
          );
          await Bun.sleep(backoff);
          continue;
        }
        const body = await resp.text().catch(() => "");
        throw new Error(
          `Server error ${String(resp.status)} after ${String(maxRetries + 1)} attempts: ${body.slice(0, 200)}`,
        );
      }

      const body = await resp.text().catch(() => "");
      throw new Error(
        `Unexpected status ${String(resp.status)}: ${body.slice(0, 200)}`,
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
