import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { boundedBytes } from "./providers.ts";

const OpenSubtitleSchema = z.object({
  id: z.string(),
  attributes: z.object({
    language: z.string(),
    release: z.string(),
    ai_translated: z.boolean().optional(),
    machine_translated: z.boolean().optional(),
    files: z.array(
      z.object({ file_id: z.number().int().positive(), file_name: z.string() }),
    ),
    feature_details: z
      .object({
        season_number: z.number().int().optional(),
        episode_number: z.number().int().optional(),
        imdb_id: z.number().int().optional(),
        tmdb_id: z.number().int().optional(),
      })
      .optional(),
  }),
});

export class OpenSubtitlesProvider {
  private token: string | undefined;
  constructor(
    private readonly config: { apiKey: string; userAgent: string },
    private readonly transport: FetchTransport = fetch,
  ) {}

  async login(
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const data = await this.call("login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      ...(signal === undefined ? {} : { signal }),
    });
    this.token = z.object({ token: z.string().min(1) }).parse(data).token;
  }

  async search(
    input: {
      query: string;
      language: string;
      season?: number;
      episode?: number;
      page?: number;
    },
    signal?: AbortSignal,
  ) {
    z.string().trim().min(1).max(200).parse(input.query);
    z.string()
      .regex(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/u)
      .parse(input.language);
    const parameters = new URLSearchParams({
      query: input.query,
      languages: input.language,
      ai_translated: "exclude",
      machine_translated: "exclude",
      page: String(
        z
          .number()
          .int()
          .positive()
          .parse(input.page ?? 1),
      ),
    });
    if (input.season !== undefined)
      parameters.set(
        "season_number",
        String(z.number().int().nonnegative().parse(input.season)),
      );
    if (input.episode !== undefined)
      parameters.set(
        "episode_number",
        String(z.number().int().nonnegative().parse(input.episode)),
      );
    const data = await this.call(
      `subtitles?${parameters.toString()}`,
      signal === undefined ? {} : { signal },
    );
    const parsed = z
      .object({
        data: z.array(OpenSubtitleSchema),
        total_pages: z.number().int().nonnegative(),
      })
      .parse(data);
    return {
      totalPages: parsed.total_pages,
      candidates: parsed.data.filter(
        (candidate) =>
          candidate.attributes.ai_translated !== true &&
          candidate.attributes.machine_translated !== true,
      ),
    };
  }

  /** This can consume provider quota; callers checkpoint before resolving a download link. */
  async download(
    fileId: number,
    signal?: AbortSignal,
  ): Promise<{ filename: string; bytes: Uint8Array<ArrayBuffer> }> {
    z.number().int().positive().parse(fileId);
    const data = await this.call("download", {
      method: "POST",
      body: JSON.stringify({ file_id: fileId }),
      mutation: true,
      ...(signal === undefined ? {} : { signal }),
    });
    const result = z
      .object({ link: z.url(), file_name: z.string().min(1) })
      .parse(data);
    const url = allowedSubtitleUrl(result.link, [
      "dl.opensubtitles.com",
      "www.opensubtitles.com",
    ]);
    const response = await request(this.transport, "opensubtitles", url, {
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      filename: result.file_name,
      bytes: await boundedBytes(response, 8 * 1024 * 1024, "opensubtitles"),
    };
  }

  private async call(
    path: string,
    init: RequestInit & { mutation?: boolean },
  ): Promise<unknown> {
    const [pathname, query] = path.split("?");
    if (pathname === undefined) throw new Error("Missing subtitle API path");
    const url = endpoint("https://api.opensubtitles.com/api/v1", pathname);
    if (query !== undefined) url.search = query;
    const response = await request(this.transport, "opensubtitles", url, {
      ...init,
      headers: {
        "Api-Key": this.config.apiKey,
        "User-Agent": this.config.userAgent,
        "Content-Type": "application/json",
        ...(this.token === undefined
          ? {}
          : { Authorization: `Bearer ${this.token}` }),
      },
    });
    return await json(response, "opensubtitles");
  }
}

const AssrtSubtitleSchema = z.object({
  id: z.number().int().positive(),
  videoname: z.string().optional(),
  native_name: z.union([z.string(), z.array(z.string())]).optional(),
  title: z.string().optional(),
  filename: z.string().optional(),
  url: z.url().optional(),
  lang: z
    .object({
      desc: z.string().optional(),
      langlist: z.record(z.string(), z.boolean()).optional(),
    })
    .optional(),
  producer: z.object({ source: z.string().optional() }).optional(),
  filelist: z
    .array(z.object({ f: z.string(), url: z.url(), s: z.string().optional() }))
    .optional(),
});

export class AssrtProvider {
  constructor(
    private readonly token: string,
    private readonly transport: FetchTransport = fetch,
  ) {}

  async search(query: string, offset = 0, signal?: AbortSignal) {
    z.string().trim().min(3).max(200).parse(query);
    z.number().int().nonnegative().parse(offset);
    const data = await this.get(
      "sub/search",
      { q: query, pos: String(offset), cnt: "15", is_file: "1" },
      signal,
    );
    return z
      .object({
        status: z.literal(0),
        sub: z.object({
          subs: z.array(
            z.union([
              AssrtSubtitleSchema,
              z.object({
                fileid: z.number().int().positive(),
                filename: z.string().optional(),
              }),
            ]),
          ),
        }),
      })
      .parse(data).sub.subs;
  }

  async detail(id: number, signal?: AbortSignal) {
    z.number().int().positive().parse(id);
    const data = await this.get("sub/detail", { id: String(id) }, signal);
    const parsed = z
      .object({
        status: z.literal(0),
        sub: z.object({ subs: z.array(AssrtSubtitleSchema).length(1) }),
      })
      .parse(data).sub.subs[0];
    if (parsed?.id !== id)
      throw new IntegrationError("assrt", "invalid-response");
    return parsed;
  }

  /** Download only the explicitly selected member; do not silently pick the first file in a pack. */
  async downloadMember(
    id: number,
    filename: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const detail = await this.detail(id, signal);
    const members =
      detail.filelist?.filter((file) => file.f === filename) ?? [];
    const member = members[0];
    const link =
      member !== undefined && members.length === 1
        ? member.url
        : detail.filename === filename && detail.filelist?.length === 0
          ? detail.url
          : undefined;
    if (link === undefined) throw new IntegrationError("assrt", "conflict");
    const url = allowedSubtitleUrl(link, [
      "file0.assrt.net",
      "file1.assrt.net",
      "file.assrt.net",
    ]);
    const response = await request(this.transport, "assrt", url, {
      ...(signal === undefined ? {} : { signal }),
    });
    return await boundedBytes(response, 8 * 1024 * 1024, "assrt");
  }

  private async get(
    path: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = endpoint("https://api.assrt.net/v1", path);
    url.search = new URLSearchParams(parameters).toString();
    const response = await request(this.transport, "assrt", url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      ...(signal === undefined ? {} : { signal }),
    });
    return await json(response, "assrt");
  }
}

export function allowedSubtitleUrl(
  value: string,
  hosts: readonly string[],
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !hosts.includes(url.hostname) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    throw new IntegrationError("subtitle-provider", "invalid-response");
  return url;
}
