import { z } from "zod";
import {
  ProviderEditionEvidenceSchema,
  type ProviderReference,
  type ProviderEditionEvidence,
} from "#shared/acquisition/catalog.ts";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";

const HashSchema = z
  .string()
  .regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/iu)
  .transform((value) => value.toLowerCase());
const CountSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/u).transform(Number),
]);
const SearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  kind: z.enum(["movie", "tv", "anime"]),
  page: z.number().int().positive().default(1),
});
export type ProviderSearch = z.input<typeof SearchSchema>;
const RecentInputSchema = z.object({
  page: z
    .int()
    .positive()
    .max(Math.floor(Number.MAX_SAFE_INTEGER / 100)),
});
export type ProviderRecentPage = {
  candidates: ProviderCandidate[];
  scanned: number;
  nextPage: number | null;
};

/** Activity-local only: private download URLs can contain passkeys. Never emit this type into workflow history or UI responses. */
export type ProviderCandidate = {
  providerId:
    | "knaben"
    | "thepiratebay"
    | "magnetdownload"
    | "privatehd"
    | "avistaz"
    | "animez";
  providerReleaseId: string;
  title: string;
  sizeBytes: number;
  seeders: number | null;
  infoHash: string;
  detailsUrl: string;
  download: { kind: "magnet" | "torrent"; value: string };
  /** Absent unless a provider's actual wire semantics establish a catalog namespace. */
  references?: readonly ProviderReference[] | undefined;
  /** Attributed text is evidence for quality rules, never a requested-edition declaration. */
  editionEvidence?: readonly ProviderEditionEvidence[] | undefined;
};

/** Preserve each actual title field independently; title text is not structured cut metadata. */
export function releaseTitleEvidence(
  providerId: ProviderCandidate["providerId"],
  fields: readonly { field: string; text: string | null | undefined }[],
): ProviderEditionEvidence[] {
  const result = z
    .array(ProviderEditionEvidenceSchema)
    .max(20)
    .safeParse(
      fields.flatMap(({ field, text }) =>
        text === undefined || text === null || text.length === 0
          ? []
          : [{ text, provenance: { kind: "release-title", field } }],
      ),
    );
  if (!result.success)
    throw new IntegrationError(providerId, "invalid-response");
  return result.data;
}

const KnabenResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      bytes: CountSchema,
      hash: HashSchema.nullable(),
      seeders: CountSchema,
      details: z.url(),
      magnetUrl: z.string().nullable(),
      link: z.url().nullish(),
    }),
  ),
});

/** Protocol: https://knaben.org/api/v2/ */
export class KnabenProvider {
  constructor(private readonly transport: FetchTransport = fetch) {}
  async search(
    input: ProviderSearch,
    signal?: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const query = SearchSchema.parse(input);
    const url = endpoint("https://api.knaben.org", "v2/search");
    url.search = new URLSearchParams({
      q: query.query,
      s: "100",
      f: String((query.page - 1) * 100),
      o: "seeders",
    }).toString();
    const response = await this.readPage(url, signal);
    return this.candidates(response);
  }

  /** Native date-ordered browsing; no title query or seeded-search substitute. */
  async recent(
    input: { page: number },
    signal?: AbortSignal,
  ): Promise<ProviderRecentPage> {
    const { page } = RecentInputSchema.parse(input);
    const url = endpoint("https://api.knaben.org", "v2/browse");
    url.search = new URLSearchParams({
      o: "date",
      d: "desc",
      s: "100",
      f: String((page - 1) * 100),
    }).toString();
    const response = await this.readPage(url, signal);
    if (response.hits.length > 100)
      throw new IntegrationError("knaben", "invalid-response");
    return {
      candidates: this.candidates(response),
      scanned: response.hits.length,
      nextPage: response.hits.length === 100 ? page + 1 : null,
    };
  }

  private async readPage(url: URL, signal?: AbortSignal) {
    const response = KnabenResponseSchema.safeParse(
      await json(
        await request(this.transport, "knaben", url, {
          ...(signal === undefined ? {} : { signal }),
        }),
        "knaben",
      ),
    );
    if (!response.success)
      throw new IntegrationError("knaben", "invalid-response");
    return response.data;
  }

  private candidates(
    response: z.infer<typeof KnabenResponseSchema>,
  ): ProviderCandidate[] {
    // Some meta-index entries only offer another site's landing page. They cannot be submitted as verified torrents.
    return response.hits.flatMap((hit): ProviderCandidate[] =>
      hit.hash === null
        ? []
        : [
            {
              providerId: "knaben",
              providerReleaseId: hit.id,
              title: hit.title,
              editionEvidence: releaseTitleEvidence("knaben", [
                { field: "title", text: hit.title },
              ]),
              sizeBytes: hit.bytes,
              seeders: hit.seeders,
              infoHash: hit.hash,
              detailsUrl: hit.details,
              download:
                hit.magnetUrl === null
                  ? { kind: "magnet", value: magnetFor(hit.hash, hit.title) }
                  : {
                      kind: "magnet",
                      value: checkedMagnet(hit.magnetUrl, hit.hash),
                    },
            },
          ],
    );
  }
}

const PirateBayResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    info_hash: z.string(),
    size: CountSchema,
    seeders: CountSchema,
  }),
);

/** Direct apibay JSON search, without a Torznab proxy. */
export class PirateBayProvider {
  constructor(private readonly transport: FetchTransport = fetch) {}
  async search(
    input: ProviderSearch,
    signal?: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const query = SearchSchema.parse(input);
    if (query.page !== 1) return [];
    const url = endpoint("https://apibay.org", "q.php");
    url.search = new URLSearchParams({ q: query.query, cat: "200" }).toString();
    const results = PirateBayResponseSchema.parse(
      await json(
        await request(this.transport, "thepiratebay", url, {
          ...(signal === undefined ? {} : { signal }),
        }),
        "thepiratebay",
      ),
    );
    if (results.length === 1 && results[0]?.id === "0") return [];
    return results.map((item) => {
      const hash = HashSchema.parse(item.info_hash);
      return {
        providerId: "thepiratebay",
        providerReleaseId: item.id,
        title: item.name,
        editionEvidence: releaseTitleEvidence("thepiratebay", [
          { field: "name", text: item.name },
        ]),
        sizeBytes: item.size,
        seeders: item.seeders,
        infoHash: hash,
        detailsUrl: `https://thepiratebay.org/description.php?id=${encodeURIComponent(item.id)}`,
        download: { kind: "magnet", value: magnetFor(hash, item.name) },
      };
    });
  }
}

const PrivateResponseSchema = z.object({
  data: z.array(
    z.object({
      url: z.url(),
      download: z.url(),
      file_name: z.string(),
      release_title: z.string().nullish(),
      info_hash: HashSchema,
      file_size: CountSchema,
      seed: CountSchema.nullable(),
    }),
  ),
});

/** Shared direct tracker protocol. Authentication tokens remain in worker memory. */
export class AvistazFamilyProvider {
  private readonly baseUrl: string;
  constructor(
    private readonly config: {
      providerId: "privatehd" | "avistaz" | "animez";
      username: string;
      password: string;
      pid: string;
    },
    private readonly transport: FetchTransport = fetch,
    private token?: string,
  ) {
    this.baseUrl = `https://${config.providerId}.to`;
  }

  async login(signal?: AbortSignal): Promise<string> {
    const response = await request(
      this.transport,
      this.config.providerId,
      endpoint(this.baseUrl, "api/v1/jackett/auth"),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
          pid: this.config.pid,
        }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const parsed = z
      .object({ token: z.string().min(1).optional() })
      .parse(await json(response, this.config.providerId));
    if (parsed.token === undefined)
      throw new IntegrationError(this.config.providerId, "authentication");
    this.token = parsed.token;
    return parsed.token;
  }

  async search(
    input: ProviderSearch,
    signal?: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const query = SearchSchema.parse(input);
    const url = endpoint(this.baseUrl, "api/v1/jackett/torrents");
    url.search = new URLSearchParams({
      search: query.query,
      limit: "50",
      page: String(query.page),
      ...(this.config.providerId === "animez"
        ? {}
        : { in: "1", type: query.kind === "movie" ? "1" : "2" }),
    }).toString();
    return this.readPage(url, signal);
  }

  /** The family's empty search is its actual recent listing; AnimeZ has no in/type parameters. */
  async recent(
    input: { page: number },
    signal?: AbortSignal,
  ): Promise<ProviderRecentPage> {
    const { page } = RecentInputSchema.parse(input);
    const url = endpoint(this.baseUrl, "api/v1/jackett/torrents");
    url.search = new URLSearchParams({
      search: "",
      limit: "50",
      page: String(page),
      ...(this.config.providerId === "animez" ? {} : { in: "1", type: "0" }),
    }).toString();
    const candidates = await this.readPage(url, signal);
    if (candidates.length > 50)
      throw new IntegrationError(this.config.providerId, "invalid-response");
    return {
      candidates,
      scanned: candidates.length,
      nextPage: candidates.length === 50 ? page + 1 : null,
    };
  }

  private async readPage(
    url: URL,
    signal?: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const response = await request(
      this.transport,
      this.config.providerId,
      url,
      {
        headers: this.headers(),
        acceptedStatuses: [404],
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.status === 404) return [];
    const parsed = PrivateResponseSchema.safeParse(
      await json(response, this.config.providerId),
    );
    if (!parsed.success)
      throw new IntegrationError(this.config.providerId, "invalid-response");
    return parsed.data.data.map((item) => {
      const details = sameOriginUrl(item.url, this.baseUrl);
      const download = sameOriginUrl(item.download, this.baseUrl);
      return {
        providerId: this.config.providerId,
        providerReleaseId: details.pathname,
        editionEvidence: releaseTitleEvidence(this.config.providerId, [
          { field: "file_name", text: item.file_name },
          { field: "release_title", text: item.release_title },
        ]),
        title:
          this.config.providerId === "animez" &&
          item.release_title !== undefined &&
          item.release_title !== null &&
          item.release_title.length > 0
            ? item.release_title
            : item.file_name,
        sizeBytes: item.file_size,
        seeders: item.seed,
        infoHash: item.info_hash,
        detailsUrl: details.href,
        download: { kind: "torrent", value: download.href },
      };
    });
  }

  /** Keep bytes inside the submission Activity: torrent announce URLs may carry private credentials. */
  async download(
    candidate: ProviderCandidate,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (
      candidate.providerId !== this.config.providerId ||
      candidate.download.kind !== "torrent"
    )
      throw new IntegrationError(this.config.providerId, "conflict");
    const url = sameOriginUrl(candidate.download.value, this.baseUrl);
    const response = await request(
      this.transport,
      this.config.providerId,
      url,
      { headers: this.headers(), ...(signal === undefined ? {} : { signal }) },
    );
    return await boundedBytes(
      response,
      16 * 1024 * 1024,
      this.config.providerId,
    );
  }

  private headers(): Record<string, string> {
    if (this.token === undefined)
      throw new IntegrationError(this.config.providerId, "authentication");
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }
}

export function sameOriginUrl(value: string, base: string): URL {
  const url = new URL(value, base);
  if (
    url.origin !== new URL(base).origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    throw new IntegrationError("provider", "invalid-response");
  return url;
}

export function magnetFor(hash: string, name: string): string {
  HashSchema.parse(hash);
  return `magnet:?${new URLSearchParams({ xt: hash.length === 40 ? `urn:btih:${hash}` : `urn:btmh:1220${hash}`, dn: name }).toString()}`;
}

function checkedMagnet(value: string, hash: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "magnet:" ||
    !parsed.searchParams
      .getAll("xt")
      .some(
        (xt) =>
          xt.toLowerCase() === `urn:btih:${hash}` ||
          xt.toLowerCase() === `urn:btmh:1220${hash}`,
      )
  )
    throw new IntegrationError("provider", "invalid-response");
  return value;
}

export async function boundedBytes(
  response: Response,
  maximum: number,
  service: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (response.body === null)
    throw new IntegrationError(service, "invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new IntegrationError(service, "invalid-response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
