import { z } from "zod";
import type { PreparedSportsInput } from "./prepared-input.ts";
import { SportsPlaybackError } from "./failures.ts";
import { SportsSegmentDecoder } from "./segment-decoder.ts";
import { sportsMediaResponse } from "./media-range.ts";

const BootSchema = z.object({ t: z.string().min(1), hs: z.url() });
const NativeSchema = z.object({ ok: z.literal(true), q: z.url() });
const LIMIT = 32 * 1024 * 1024;
export type SportsFetch = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

function approvedResource(value: string): URL {
  const url = new URL(value);
  const cdn = url.hostname.endsWith(".tiktokcdn.com");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(cdn || url.hostname === "hs.embedse.com")
  ) {
    throw new SportsPlaybackError("unsupported-format");
  }
  return url;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new SportsPlaybackError("unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array))
        throw new SportsPlaybackError("unsupported-format");
      size += value.length;
      if (size > LIMIT) throw new SportsPlaybackError("unsupported-format");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

type RelayResource = {
  readonly url: string;
  readonly playlist: boolean;
  inFlight: number;
};

/** The provider's supported native HLS endpoint avoids its encrypted playlist envelope. */
export async function prepareLoaderHls(
  html: string,
  pageUrl: string,
  signal: AbortSignal,
  options: {
    readonly fetcher?: SportsFetch;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<PreparedSportsInput | null> {
  signal.throwIfAborted();
  const fetcher = options.fetcher ?? fetch;
  const literal = /\bvar\s+_seEsBoot\s*=\s*(\{[^;]+\});/.exec(html)?.[1];
  if (literal === undefined) return null;
  const boot = BootSchema.parse(JSON.parse(literal));
  const endpoint = approvedResource(boot.hs);
  if (endpoint.hostname !== "hs.embedse.com" || endpoint.pathname !== "/v/hs")
    throw new SportsPlaybackError("unsupported-format");
  const headers = {
    ...options.headers,
    Referer: pageUrl,
    Origin: new URL(pageUrl).origin,
  };
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { ...headers, "Content-Type": "text/plain" },
    body: JSON.stringify({ mt: boot.t, q: 1 }),
  });
  if (!response.ok) throw new SportsPlaybackError("unavailable");
  const native = NativeSchema.safeParse(
    JSON.parse(new TextDecoder().decode(await readBounded(response))),
  );
  if (!native.success) throw new SportsPlaybackError("unavailable");
  const playlist = approvedResource(native.data.q);
  if (
    playlist.hostname !== endpoint.hostname ||
    !playlist.pathname.startsWith("/q/")
  )
    throw new SportsPlaybackError("unsupported-format");
  return createSportsHlsRelay(playlist, headers, signal, { fetcher });
}

export type SportsHlsRelayOptions = {
  readonly fetcher?: SportsFetch;
  readonly approve?: (value: string) => URL;
  readonly transformSegment?: (
    value: Uint8Array,
  ) => Uint8Array | Promise<Uint8Array>;
  readonly transformPlaylist?: (value: string) => string;
};

export function createSportsHlsRelay(
  initial: URL,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  options: SportsHlsRelayOptions = {},
): PreparedSportsInput {
  signal.throwIfAborted();
  const fetcher = options.fetcher ?? fetch;
  const approve = options.approve ?? approvedResource;
  const lifetime = new AbortController();
  const decoder = new SportsSegmentDecoder();
  const failure = Promise.withResolvers<never>();
  void observeFailure(failure.promise);
  const resources = new Map<string, RelayResource>();
  const ids = new Map<string, string>();
  const references = new Map<string, Set<string>>();
  const prune = () => {
    const retained = new Set(
      [...references.values()].flatMap((value) => [...value]),
    );
    for (const [id, resource] of resources) {
      if (!resource.playlist && resource.inFlight === 0 && !retained.has(id)) {
        resources.delete(id);
        ids.delete(resource.url);
      }
    }
  };
  const prefix = "/" + crypto.randomUUID() + "/";
  const register = (raw: string, base: string, playlist: boolean): string => {
    const url = approve(new URL(raw, base).href).href;
    let id = ids.get(url);
    if (id === undefined) {
      const extension =
        /\.(?:mp4|m4s|aac|ts|key)$/i.exec(new URL(url).pathname)?.[0] ?? ".ts";
      id = crypto.randomUUID() + (playlist ? ".m3u8" : extension);
      ids.set(url, id);
      resources.set(id, { url, playlist, inFlight: 0 });
      if (resources.size > 4096)
        throw new SportsPlaybackError("unsupported-format");
    }
    return prefix + id;
  };
  const rewrite = (text: string, base: string): string => {
    if (!text.trimStart().startsWith("#EXTM3U"))
      throw new SportsPlaybackError("unsupported-format");
    const current = new Set<string>();
    const link = (value: string) => {
      const path = register(value, base, /\.m3u8(?:\?|$)/i.test(value));
      current.add(path.slice(prefix.length));
      return path;
    };
    const source = options.transformPlaylist?.(text) ?? text;
    const rewritten = source
      .split(/\r?\n/)
      .map((line) => {
        if (line.length === 0) return line;
        return line.startsWith("#")
          ? line.replaceAll(
              /URI="([^"]+)"/g,
              (_match, value: string) => `URI="${link(value)}"`,
            )
          : link(line);
      })
      .join("\n");
    references.set(base, current);
    prune();
    return rewritten;
  };
  const initialPath = register(initial.href, initial.href, true);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" || !path.startsWith(prefix))
        return new Response(null, { status: 404 });
      const resource = resources.get(path.slice(prefix.length));
      if (resource === undefined) return new Response(null, { status: 404 });
      resource.inFlight++;
      try {
        const upstream = await fetcher(resource.url, {
          headers,
          redirect: "error",
          signal: AbortSignal.any([
            lifetime.signal,
            request.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!upstream.ok)
          throw new SportsPlaybackError(
            upstream.status === 403 ? "session-expired" : "unavailable",
          );
        const bytes = await readBounded(upstream);
        const transformSegment =
          options.transformSegment ?? decoder.decode.bind(decoder);
        if (!resource.playlist)
          return sportsMediaResponse(
            await transformSegment(bytes),
            request.headers.get("Range"),
          );
        return new Response(
          rewrite(new TextDecoder().decode(bytes), resource.url),
          {
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store",
            },
          },
        );
      } catch (error) {
        if (!lifetime.signal.aborted && !request.signal.aborted)
          failure.reject(
            error instanceof SportsPlaybackError
              ? error
              : new SportsPlaybackError("unavailable"),
          );
        return new Response(null, { status: 502 });
      } finally {
        resource.inFlight--;
        prune();
      }
    },
  });
  const input = server.url.origin + initialPath;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    signal.removeEventListener("abort", onAbort);
    lifetime.abort();
    closePromise = (async () => {
      await server.stop(true);
      await decoder.close();
      resources.clear();
      ids.clear();
      references.clear();
    })();
    return closePromise;
  };
  const onAbort = () => {
    void close();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    title: "Live sports",
    input,
    headers: {},
    close,
    failure: failure.promise,
  };
}

async function observeFailure(failure: Promise<never>): Promise<void> {
  try {
    await failure;
  } catch {
    /* The owning playback actor consumes the same failure promise. */
  }
}
