import type { z } from "zod";
import type { FetchTransport } from "#integrations/http.ts";
import { MAX_MIGRATION_BYTES, MAX_MIGRATION_PAGES } from "#shared/migration.ts";

export class CaptureReadError extends Error {
  constructor(readonly reason: "read_failed" | "page_limit" | "record_limit") {
    super(`Source capture protected: ${reason}`);
  }
}

/** Credentials and endpoints stay in memory. Failures never include response bodies or URLs. */
export class CaptureReader {
  pages = 0;
  private bytes = 0;
  constructor(
    private readonly source: { baseUrl: string; apiKey: string },
    private readonly fetcher: FetchTransport = fetch,
  ) {
    const url = new URL(source.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid capture source URL");
  }
  async read<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    if (this.pages >= MAX_MIGRATION_PAGES / 2)
      throw new CaptureReadError("page_limit");
    this.pages++;
    try {
      const url = new URL(this.source.baseUrl);
      url.pathname = `${url.pathname.replace(/\/$/u, "")}/${endpoint.split("?")[0] ?? ""}`;
      url.search = endpoint.split("?")[1] ?? "";
      const response = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        headers: { "X-Api-Key": this.source.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok || response.body === null)
        throw new CaptureReadError("read_failed");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          this.bytes += next.value.length;
          if (this.bytes > MAX_MIGRATION_BYTES)
            throw new CaptureReadError("record_limit");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      if (error instanceof CaptureReadError) throw error;
      throw new CaptureReadError("read_failed");
    }
  }
}
