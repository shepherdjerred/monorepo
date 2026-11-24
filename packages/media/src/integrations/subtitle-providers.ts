import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AssrtLookupInvocation } from "#domain/subtitle-maintenance/provider.ts";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { boundedBytes } from "./providers.ts";
import {
  OpenSubtitlesSessionSchema,
  requestOpenSubtitlesApi,
} from "./open-subtitles-http.ts";

const OpenSubtitleSchema = z.object({
  id: z.string(),
  attributes: z.object({
    language: z.string(),
    release: z.string(),
    ai_translated: z.boolean().optional(),
    machine_translated: z.boolean().optional(),
    foreign_parts_only: z.boolean().nullable().optional(),
    hearing_impaired: z.boolean().nullable().optional(),
    files: z.array(
      z.object({ file_id: z.number().int().positive(), file_name: z.string() }),
    ),
    feature_details: z
      .object({
        season_number: z.number().int().optional(),
        episode_number: z.number().int().optional(),
        imdb_id: z.number().int().optional(),
        parent_imdb_id: z.number().int().positive().nullable().optional(),
        tmdb_id: z.number().int().optional(),
      })
      .optional(),
  }),
});

export class OpenSubtitlesProvider {
  private session: z.infer<typeof OpenSubtitlesSessionSchema> | undefined;
  constructor(
    private readonly config: { apiKey: string; userAgent: string },
    private readonly transport: FetchTransport = fetch,
  ) {}

  async login(
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.session = undefined;
    const data = await this.call("login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      ...(signal === undefined ? {} : { signal }),
    });
    const session = OpenSubtitlesSessionSchema.safeParse(data);
    if (!session.success)
      throw new IntegrationError("opensubtitles", "invalid-response");
    this.session = session.data;
  }

  async search(
    input: {
      query: string;
      language: string;
      season?: number;
      episode?: number;
      page?: number;
      forced?: boolean;
      hearingImpaired?: "required" | "excluded" | "any";
      imdbId?: string;
      parentImdbId?: string;
    },
    signal?: AbortSignal,
  ) {
    const query = z.string().trim().min(1).max(200).parse(input.query);
    const language = z
      .string()
      .regex(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/u)
      .parse(input.language.toLowerCase());
    const parameters = new URLSearchParams({
      query: query.toLowerCase(),
      languages: language,
      ai_translated: "exclude",
    });
    // The provider excludes machine translations by default.
    const page = z
      .int()
      .positive()
      .parse(input.page ?? 1);
    if (page !== 1) parameters.set("page", String(page));
    if (input.forced !== undefined)
      parameters.set("foreign_parts_only", input.forced ? "only" : "exclude");
    if (input.imdbId !== undefined)
      parameters.set(
        "imdb_id",
        BigInt(
          z
            .string()
            .regex(/^tt\d+$/u)
            .parse(input.imdbId)
            .slice(2),
        ).toString(),
      );
    if (input.parentImdbId !== undefined)
      parameters.set(
        "parent_imdb_id",
        BigInt(
          z
            .string()
            .regex(/^tt\d+$/u)
            .parse(input.parentImdbId)
            .slice(2),
        ).toString(),
      );
    if (
      input.hearingImpaired === "required" ||
      input.hearingImpaired === "excluded"
    )
      parameters.set(
        "hearing_impaired",
        input.hearingImpaired === "required" ? "only" : "exclude",
      );
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
    parameters.sort();
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
    const session = this.session;
    const url = endpoint(
      `https://${session?.base_url ?? "api.opensubtitles.com"}/api/v1`,
      pathname,
    );
    if (query !== undefined) url.search = query;
    const response = await requestOpenSubtitlesApi(this.transport, url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Api-Key": this.config.apiKey,
        "User-Agent": this.config.userAgent,
        "Content-Type": "application/json",
        ...(session === undefined
          ? {}
          : { Authorization: `Bearer ${session.token}` }),
      },
    });
    return await json(response, "opensubtitles");
  }
}

const AssrtSubtitleIdSchema = z.int().positive();
const AssrtSubtitleSchema = z.object({
  id: AssrtSubtitleIdSchema,
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

function assrtLookupDeadline(
  maximumMs: number,
  now: number,
  invocation: AssrtLookupInvocation,
): number {
  const { observed, expiresAtMs } = invocation;
  // Keep the earlier authority window and reserve time for fallback or persistence.
  const wallDeadline = Math.min(
    observed.wall + maximumMs,
    (expiresAtMs ?? Infinity) - 5000,
  );
  return Math.min(
    observed.monotonic + (wallDeadline - observed.wall),
    now + (wallDeadline - Date.now()),
  );
}

export class AssrtProvider {
  private pacing?: {
    intervalSeconds: number;
    nextRequestAtMs: number;
    deadlineMs: number;
    signal: AbortSignal;
  };

  constructor(
    private readonly token: string,
    private readonly transport: FetchTransport = fetch,
  ) {}

  /** Each production lookup starts with the quota GET, which also consumes a request. */
  async paceLookup(
    maximumMs: number,
    invocation?: AssrtLookupInvocation,
  ): Promise<number> {
    const now = performance.now();
    const deadlineMs =
      invocation === undefined
        ? now + maximumMs
        : assrtLookupDeadline(maximumMs, now, invocation);
    const timeoutMs = Math.floor(deadlineMs - now);
    const signal = invocation?.signal;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      signal?.aborted === true
    )
      throw new IntegrationError("assrt", "unavailable");
    const timeout = AbortSignal.timeout(timeoutMs);
    const lookupSignal =
      signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const data = await this.get("user/quota", {}, lookupSignal);
    const response = z
      .object({
        status: z.literal(0),
        user: z.object({ quota: z.int().positive() }),
      })
      .safeParse(data);
    if (!response.success)
      throw new IntegrationError("assrt", "invalid-response");
    const intervalSeconds = Math.ceil(60 / response.data.user.quota);
    this.pacing = {
      intervalSeconds,
      nextRequestAtMs: performance.now() + intervalSeconds * 1000,
      deadlineMs,
      signal: lookupSignal,
    };
    return intervalSeconds;
  }

  /** Reserve time for the next metadata GET before journaling a download. */
  async waitForMetadataSlot(signal?: AbortSignal): Promise<void> {
    const pacing = this.pacing;
    if (pacing === undefined) return;
    const lookupSignal = this.lookupSignal(signal);
    for (;;) {
      const now = performance.now();
      if (lookupSignal?.aborted === true || now >= pacing.deadlineMs)
        throw new IntegrationError("assrt", "unavailable");
      const waitMs = Math.ceil(pacing.nextRequestAtMs - now);
      if (waitMs <= 0) return;
      if (now + waitMs >= pacing.deadlineMs)
        throw new IntegrationError(
          "assrt",
          "rate-limited",
          undefined,
          pacing.intervalSeconds,
        );
      try {
        await delay(waitMs, undefined, { signal: lookupSignal });
      } catch {
        throw new IntegrationError("assrt", "unavailable");
      }
    }
  }

  private lookupSignal(signal?: AbortSignal): AbortSignal | undefined {
    const pacing = this.pacing;
    if (pacing === undefined) return signal;
    return signal === undefined
      ? pacing.signal
      : AbortSignal.any([signal, pacing.signal]);
  }

  private lookupExpired(signal: AbortSignal | undefined): boolean {
    return (
      signal?.aborted === true ||
      (this.pacing !== undefined && performance.now() >= this.pacing.deadlineMs)
    );
  }

  async search(query: string, offset = 0, signal?: AbortSignal) {
    z.string().trim().min(3).max(200).parse(query);
    z.number().int().nonnegative().parse(offset);
    const data = await this.get(
      "sub/search",
      { q: query, pos: String(offset), cnt: "15", is_file: "1" },
      signal,
    );
    const response = z
      .object({
        status: z.literal(0),
        sub: z.object({
          subs: z.array(
            z.union([
              AssrtSubtitleSchema,
              z.object({
                fileid: z.union([
                  AssrtSubtitleIdSchema,
                  z
                    .string()
                    .regex(/^\d+$/u)
                    .transform(Number)
                    .pipe(AssrtSubtitleIdSchema),
                ]),
                filename: z.string().optional(),
              }),
            ]),
          ),
        }),
      })
      .safeParse(data);
    if (!response.success)
      throw new IntegrationError("assrt", "invalid-response");
    return response.data.sub.subs;
  }

  async detail(id: number, signal?: AbortSignal) {
    AssrtSubtitleIdSchema.parse(id);
    const data = await this.get("sub/detail", { id: String(id) }, signal);
    const response = z
      .object({
        status: z.literal(0),
        sub: z.object({ subs: z.array(AssrtSubtitleSchema).length(1) }),
      })
      .safeParse(data);
    if (!response.success)
      throw new IntegrationError("assrt", "invalid-response");
    const parsed = response.data.sub.subs[0];
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
    const lookupSignal = this.lookupSignal(signal);
    try {
      if (this.lookupExpired(lookupSignal))
        throw new IntegrationError("assrt", "outcome-unknown");
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
      if (this.lookupExpired(lookupSignal))
        throw new IntegrationError("assrt", "outcome-unknown");
      const response = await request(this.transport, "assrt", url, {
        ...(lookupSignal === undefined ? {} : { signal: lookupSignal }),
      });
      const bytes = await boundedBytes(response, 8 * 1024 * 1024, "assrt");
      if (this.lookupExpired(lookupSignal))
        throw new IntegrationError("assrt", "outcome-unknown");
      return bytes;
    } catch (error) {
      return this.throwDownloadFailure(error, lookupSignal);
    }
  }

  private throwDownloadFailure(error: unknown, signal?: AbortSignal): never {
    const failure = error instanceof IntegrationError ? error : undefined;
    // A known HTTP or matching failure remains definitive even if cancellation arrives.
    const definitive =
      failure?.status !== undefined ||
      failure?.kind === "conflict" ||
      failure?.kind === "invalid-response";
    if (
      !definitive &&
      (failure?.kind === "unavailable" || this.lookupExpired(signal))
    )
      throw new IntegrationError("assrt", "outcome-unknown");
    throw error;
  }

  private async get(
    path: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.waitForMetadataSlot(signal);
    const url = endpoint("https://api.assrt.net/v1", path);
    url.search = new URLSearchParams(parameters).toString();
    const lookupSignal = this.lookupSignal(signal);
    try {
      const response = await request(this.transport, "assrt", url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        ...(lookupSignal === undefined ? {} : { signal: lookupSignal }),
      });
      return await json(response, "assrt");
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        error.kind === "invalid-response" &&
        this.lookupExpired(lookupSignal)
      )
        throw new IntegrationError("assrt", "unavailable");
      throw error;
    } finally {
      const pacing = this.pacing;
      if (pacing !== undefined)
        pacing.nextRequestAtMs =
          performance.now() + pacing.intervalSeconds * 1000;
    }
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
