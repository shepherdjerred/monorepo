import { XMLParser } from "fast-xml-parser";
import Builder from "fast-xml-builder";
import { z } from "zod";
import type { PreparedSportsInput } from "./prepared-input.ts";
import { createSportsHlsRelay } from "./loader-hls.ts";
import { SportsPlaybackError } from "./failures.ts";
import {
  createDashResourceRegistry,
  readSportsResponse,
} from "./clearkey-dash-resources.ts";

const record = z.record(z.string(), z.unknown());
const hex = z.string().regex(/^[\da-f]{32}$/i);
const PayloadSchema = z.object({ m: z.url(), k: z.record(hex, hex) });
const EnvelopeSchema = z.object({
  ok: z.literal(true),
  n: z.string().min(1),
  p: z.string().min(1),
});
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
});
const builder = new Builder({
  ignoreAttributes: false,
  processEntities: true,
  format: true,
});
type ObjectNode = Record<string, unknown>;
async function observeFailure(promise: Promise<never>): Promise<void> {
  try {
    await promise;
  } catch {
    /* Observed again by the playback actor. */
  }
}
type FetchMedia = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;
const MediaKindSchema = z.looseObject({
  "@_contentType": z.string().optional(),
  "@_mimeType": z.string().optional(),
});
const URL_ATTRIBUTES = new Set([
  "@_media",
  "@_initialization",
  "@_sourceURL",
  "@_href",
  "@_xlink:href",
]);

function nodes(value: unknown): ObjectNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((item) =>
    record.parse(item),
  );
}

function approvedUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !approvedMediaHost(url.hostname)
  )
    throw new Error("ClearKey media host is not approved");
  return url;
}

function approvedMediaHost(host: string): boolean {
  return (
    host === "v2.streameast.ga" ||
    host === "hs.embedse.com" ||
    host === "u.steast.io" ||
    host === "lpnba.akamaized.net"
  );
}

export async function decodeClearKeyBootstrap(
  ticket: string,
  response: unknown,
) {
  const envelope = EnvelopeSchema.parse(response);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ck|${ticket}|${envelope.n}`),
  );
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "decrypt",
  ]);
  const bytes = Uint8Array.from(
    atob(envelope.p),
    (character) => character.codePointAt(0) ?? 0,
  );
  if (bytes.length < 29)
    throw new Error("ClearKey bootstrap payload is truncated");
  const decoded = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return PayloadSchema.parse(JSON.parse(new TextDecoder().decode(decoded)));
}

function trackKind(adaptation: ObjectNode): "video" | "audio" | null {
  const candidates = [adaptation, ...nodes(adaptation["Representation"])];
  for (const candidate of candidates) {
    const node = MediaKindSchema.parse(candidate);
    const kind = node["@_contentType"] ?? node["@_mimeType"]?.split("/")[0];
    if (kind === "video" || kind === "audio") return kind;
  }
  return null;
}

function keyId(adaptation: ObjectNode): string {
  const protections = [
    ...nodes(adaptation["ContentProtection"]),
    ...nodes(adaptation["Representation"]).flatMap((representation) =>
      nodes(representation["ContentProtection"]),
    ),
  ];
  const ids = new Set(
    protections.flatMap((node) => {
      const raw = node["@_cenc:default_KID"];
      return typeof raw === "string"
        ? raw
            .trim()
            .split(/\s+/)
            .map((id) => id.replaceAll("-", "").toLowerCase())
        : [];
    }),
  );
  if (ids.size !== 1)
    throw new Error("ClearKey track must declare one stable key ID");
  return hex.parse([...ids][0]);
}

function validateBaseUrls(value: unknown, base: URL): void {
  for (const item of Array.isArray(value) ? value : [value]) {
    approvedUrl(new URL(z.string().parse(item), base).href);
  }
}

function validateResources(value: unknown, base: URL): void {
  if (Array.isArray(value)) {
    for (const child of value) validateResources(child, base);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = record.parse(value);
  const rawBase = node["BaseURL"];
  const localBase =
    typeof rawBase === "string"
      ? approvedUrl(new URL(rawBase, base).href)
      : base;
  for (const [name, child] of Object.entries(node)) {
    if (URL_ATTRIBUTES.has(name))
      approvedUrl(new URL(z.string().parse(child), localBase).href);
    else if (name === "BaseURL") validateBaseUrls(child, base);
    else validateResources(child, localBase);
  }
}

/** Produce one independently decryptable MPD per media kind. */
export function splitClearKeyManifest(
  xml: string,
  manifestUrl: string,
  keys: Readonly<Record<string, string>>,
) {
  if (xml.length > 2_097_152 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("ClearKey manifest is invalid");
  const root = record.parse(parser.parse(xml));
  const mpd = record.parse(root["MPD"]);
  const periods = nodes(mpd["Period"]);
  if (periods.length === 0) throw new Error("ClearKey manifest has no periods");
  const base = approvedUrl(manifestUrl);
  validateResources(mpd, base);
  const result = new Map<"video" | "audio", { xml: string; key: string }>();
  for (const kind of ["video", "audio"] as const) {
    const trackKeys = new Set<string>();
    const views = periods.map((period) => {
      const adaptation = nodes(period["AdaptationSet"]).find(
        (candidate) => trackKind(candidate) === kind,
      );
      if (adaptation === undefined)
        throw new Error(`ClearKey manifest has no ${kind} adaptation`);
      const id = keyId(adaptation);
      const key = keys[id];
      if (key === undefined) throw new SportsPlaybackError("session-expired");
      trackKeys.add(hex.parse(key));
      return { ...period, AdaptationSet: adaptation };
    });
    if (trackKeys.size !== 1) throw new SportsPlaybackError("session-expired");
    // Root BaseURL preserves relative DASH templates after serving MPD on loopback.
    const bases = mpd["BaseURL"];
    const originBase = new URL(".", base).href;
    const normalizeBase = (value: unknown): string =>
      approvedUrl(new URL(z.string().parse(value), base).href).href;
    const rootBase =
      bases === undefined
        ? originBase
        : Array.isArray(bases)
          ? bases.map((value) => normalizeBase(value))
          : normalizeBase(bases);
    const key = [...trackKeys][0];
    if (key === undefined) throw new Error("ClearKey track has no key");
    result.set(kind, {
      xml: builder.build({
        ...root,
        MPD: { ...mpd, BaseURL: rootBase, Period: views },
      }),
      key,
    });
  }
  const video = result.get("video");
  const audio = result.get("audio");
  if (video === undefined || audio === undefined)
    throw new Error("ClearKey media tracks are missing");
  return { video, audio };
}

type ClearKeyOptions = {
  fetcher?: FetchMedia;
  headers?: Readonly<Record<string, string>>;
};

export async function prepareClearKey(
  html: string,
  frameUrl: string,
  signal: AbortSignal,
  options: ClearKeyOptions = {},
): Promise<PreparedSportsInput | null> {
  try {
    return await prepareClearKeyInput(html, frameUrl, signal, options);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SportsPlaybackError) throw error;
    throw new SportsPlaybackError("unsupported-format");
  }
}

async function prepareClearKeyInput(
  html: string,
  frameUrl: string,
  signal: AbortSignal,
  options: ClearKeyOptions,
): Promise<PreparedSportsInput | null> {
  const configText = /window\.SE_CK\s*=\s*(\{[^\n]+?\})\s*;/.exec(html)?.[1];
  if (configText === undefined) return null;
  const config = z
    .object({ t: z.string().min(1), v: z.boolean().optional() })
    .parse(JSON.parse(configText));
  const frame = approvedUrl(frameUrl);
  if (
    frame.hostname !== "v2.streameast.ga" ||
    frame.pathname !== "/ClearKeyEmbed.php"
  )
    throw new Error("ClearKey player page is not approved");
  const fetcher = options.fetcher ?? fetch;
  const headers = {
    ...options.headers,
    Referer: frame.href,
    Origin: frame.origin,
  };
  const response = await fetcher(frame, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ct: config.t }),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new SportsPlaybackError("unavailable");
  const payload = await decodeClearKeyBootstrap(
    config.t,
    JSON.parse(
      new TextDecoder().decode(await readSportsResponse(response, 1_048_576)),
    ),
  );
  const manifest = approvedUrl(payload.m);
  manifest.searchParams.set("sessionId", crypto.randomUUID());
  if (/\.m3u8$/i.test(manifest.pathname)) {
    const mediaKeys = [...new Set(Object.values(payload.k))];
    const mediaKey = mediaKeys[0];
    if (mediaKey === undefined || mediaKeys.length !== 1)
      throw new SportsPlaybackError("unsupported-format");
    const relay = createSportsHlsRelay(manifest, headers, signal, {
      fetcher,
      approve: (value) => approvedUrl(value),
      transformSegment: (bytes) => bytes,
      transformPlaylist: stripClearKeyHlsTags,
    });
    return {
      ...relay,
      inputOptions: ["-seg_format_options", `decryption_key=${mediaKey}`],
    };
  }
  const lifetime = new AbortController();
  const load = async (requestSignal: AbortSignal) => {
    const upstream = await fetcher(manifest, {
      headers,
      redirect: "error",
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(15_000)]),
    });
    if (!upstream.ok)
      throw new SportsPlaybackError(
        upstream.status === 403 ? "session-expired" : "unavailable",
      );
    return splitClearKeyManifest(
      new TextDecoder().decode(await readSportsResponse(upstream, 2_097_152)),
      manifest.href,
      payload.k,
    );
  };
  const initial = await load(signal);
  signal.throwIfAborted();
  const nonce = crypto.randomUUID();
  const failure = Promise.withResolvers<never>();
  void observeFailure(failure.promise);
  const registry = createDashResourceRegistry(
    `/${nonce}/resource/`,
    approvedUrl,
  );
  let origin = "";
  const serveResource = async (
    resource: URL,
    request: Request,
  ): Promise<Response> => {
    const range = request.headers.get("Range");
    const upstream = await fetcher(resource, {
      headers: { ...headers, ...(range === null ? {} : { Range: range }) },
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
    return new Response(await readSportsResponse(upstream, 33_554_432), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  };
  const serveManifest = async (
    kind: "video" | "audio",
    request: Request,
  ): Promise<Response> => {
    const current = await load(
      AbortSignal.any([lifetime.signal, request.signal]),
    );
    if (current[kind].key !== initial[kind].key)
      throw new SportsPlaybackError("session-expired");
    const xml = registry
      .rewrite(current[kind].xml, manifest.href)
      .replaceAll(`/${nonce}/resource/`, `${origin}/${nonce}/resource/`);
    return new Response(xml, {
      headers: {
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
      },
    });
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (request.method !== "GET") return new Response(null, { status: 404 });
      try {
        const resource = registry.resolve(pathname);
        if (resource !== null) return await serveResource(resource, request);
        if (pathname === `/${nonce}/video.mpd`)
          return await serveManifest("video", request);
        return pathname === `/${nonce}/audio.mpd`
          ? await serveManifest("audio", request)
          : new Response(null, { status: 404 });
      } catch (error) {
        if (!lifetime.signal.aborted && !request.signal.aborted)
          failure.reject(
            error instanceof SportsPlaybackError
              ? error
              : new SportsPlaybackError("unavailable"),
          );
        return new Response(null, { status: 502 });
      }
    },
  });
  origin = server.url.origin;
  const base = `http://127.0.0.1:${String(server.port)}/${nonce}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", onAbort);
    lifetime.abort();
    registry.clear();
    await server.stop(true);
  };
  const onAbort = () => {
    void close();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) await close();
  return {
    title: "Live sports",
    input: `${base}/video.mpd`,
    headers,
    inputOptions: ["-cenc_decryption_key", initial.video.key],
    audioInput: `${base}/audio.mpd`,
    audioInputHeaders: headers,
    audioInputOptions: ["-cenc_decryption_key", initial.audio.key],
    close,
    failure: failure.promise,
  };
}

/** CENC is decrypted by the fMP4 segment demuxer, rather than HLS's key handler. */
export function stripClearKeyHlsTags(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      if (
        !line.startsWith("#EXT-X-KEY:") &&
        !line.startsWith("#EXT-X-SESSION-KEY:")
      )
        return true;
      if (!/METHOD=SAMPLE-AES(?:-CTR)?(?:,|$)/.test(line))
        throw new SportsPlaybackError("unsupported-format");
      return false;
    })
    .join("\n");
}
