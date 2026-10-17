import { load } from "cheerio";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import {
  boundedBytes,
  magnetFor,
  sameOriginUrl,
  releaseTitleEvidence,
  type ProviderCandidate,
} from "./providers.ts";

const RowSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  title: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type MagnetDownloadResult = z.infer<typeof RowSchema>;

/** Direct HTML search and the site's json_info endpoint; no proxy process. */
export class MagnetDownloadProvider {
  private readonly baseUrl = "https://www.magnetdownload.com";
  constructor(private readonly transport: FetchTransport = fetch) {}

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<MagnetDownloadResult[]> {
    z.string().trim().min(1).max(200).parse(query);
    const response = await request(
      this.transport,
      "magnetdownload",
      endpoint(this.baseUrl, `search/${encodeURIComponent(query)}/`),
      { ...(signal === undefined ? {} : { signal }) },
    );
    const body = await boundedBytes(
      response,
      2 * 1024 * 1024,
      "magnetdownload",
    );
    return parseMagnetDownloadSearch(new TextDecoder().decode(body));
  }

  async resolve(
    result: MagnetDownloadResult,
    signal?: AbortSignal,
  ): Promise<ProviderCandidate> {
    RowSchema.parse(result);
    const url = endpoint(this.baseUrl, "api/json_info");
    url.search = new URLSearchParams({ hashes: result.id }).toString();
    const response = await request(this.transport, "magnetdownload", url, {
      ...(signal === undefined ? {} : { signal }),
    });
    const metadata = await json(response, "magnetdownload");
    const hash = resolveMagnetDownloadHash(metadata);
    return {
      providerId: "magnetdownload",
      providerReleaseId: result.id,
      title: result.title,
      editionEvidence: releaseTitleEvidence("magnetdownload", [
        { field: "search.infoAnchor.title", text: result.title },
      ]),
      sizeBytes: result.sizeBytes,
      seeders: null,
      infoHash: hash,
      detailsUrl: sameOriginUrl(`/info/${result.id}`, this.baseUrl).href,
      download: { kind: "magnet", value: magnetFor(hash, result.title) },
    };
  }
}

export function parseMagnetDownloadSearch(
  html: string,
): MagnetDownloadResult[] {
  const $ = load(html);
  const rows = $("tr > td.x-item");
  if (rows.length === 0) {
    if (/no (?:results|torrents|matches)/iu.test($("body").text())) return [];
    throw new IntegrationError("magnetdownload", "invalid-response");
  }
  return rows.toArray().map((element) => {
    const row = $(element);
    const anchor = row.find("a[href^='/info/']").first();
    const id = anchor.attr("href")?.match(/^\/info\/(\d+)\/?$/u)?.[1];
    const title = anchor.attr("title");
    const size = /size\s*:\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)\b/iu.exec(
      row.find("div.tail").text(),
    );
    const amount = size?.[1];
    const unit = size?.[2];
    if (amount === undefined || unit === undefined)
      throw new IntegrationError("magnetdownload", "invalid-response");
    const exponent = ["b", "kb", "mb", "gb", "tb"].indexOf(
      unit.toLowerCase().replace("i", ""),
    );
    if (exponent === -1)
      throw new IntegrationError("magnetdownload", "invalid-response");
    return RowSchema.parse({
      id,
      title,
      sizeBytes: Math.round(Number(amount) * 1024 ** exponent),
    });
  });
}

/** Accept only a unique full hash in bounded metadata; ambiguous or changed responses require intervention. */
export function resolveMagnetDownloadHash(metadata: unknown): string {
  const hashes = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 10)
      throw new IntegrationError("magnetdownload", "invalid-response");
    if (typeof value === "string") {
      if (/^[a-f\d]{40}$/iu.test(value)) hashes.add(value.toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = z.record(z.string(), z.unknown()).safeParse(value);
    if (!record.success) return;
    for (const [key, item] of Object.entries(record.data)) {
      if (/^[a-f\d]{40}$/iu.test(key)) hashes.add(key.toLowerCase());
      visit(item, depth + 1);
    }
  };
  visit(metadata, 0);
  const hash = hashes.values().next().value;
  if (hash === undefined || hashes.size !== 1)
    throw new IntegrationError("magnetdownload", "invalid-response");
  return hash;
}
