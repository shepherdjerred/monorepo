import {
  SportsEventSchema,
  type SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { SportsPageRenderer } from "@shepherdjerred/streambot/sports/pinchtab.ts";
import type { SportsResolver } from "@shepherdjerred/streambot/sports/types.ts";

const PAGE_HOSTS = new Set([
  "v2.streameast.ga",
  "tvsportslive.fr",
  "streame.center",
  "embed.st",
]);
const MAX_EMBED_DEPTH = 3;
const STREAM_URL =
  /(?:https?:)?\\?\/\\?\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi;

function validPublicHttpsUrl(
  value: string,
  allowedHosts: (host: string) => boolean,
): URL | null {
  try {
    const url = new URL(value.replaceAll(String.raw`\/`, "/"));
    return url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0 ||
      !allowedHosts(url.hostname.toLowerCase())
      ? null
      : url;
  } catch {
    return null;
  }
}

function allowedPageHost(host: string): boolean {
  return PAGE_HOSTS.has(host) || /^edgestream\d+\.pro$/.test(host);
}

function allowedStreamHost(host: string): boolean {
  return (
    host === "streame.center" ||
    /^edgestream\d+\.pro$/.test(host) ||
    host === STREAMEAST_PLAYLIST_HOST ||
    tvSportsStreamHost(host)
  );
}

function tvSportsStreamHost(host: string): boolean {
  return /^lb\d+\.strmd\.st$/.test(host);
}

/** StreamEast's first-party player playlist host (`/ps/<channel>/index.m3u8`). */
const STREAMEAST_PLAYLIST_HOST = "u.steast.io";

/**
 * Playlists whose MPEG-TS segments ffmpeg's HLS demuxer would reject by extension: TvSportsLive's
 * CDN serves them extensionless, and StreamEast's playlist points them at an image CDN with an
 * `.image` suffix. Both are real MPEG-TS; ffprobe and ffmpeg need the extension check relaxed.
 */
function disguisedSegmentHost(host: string): boolean {
  return tvSportsStreamHost(host) || host === STREAMEAST_PLAYLIST_HOST;
}

const DISGUISED_SEGMENT_HLS_INPUT_OPTIONS = [
  "-allowed_segment_extensions",
  "none,ts,m4s,m3u8",
  "-extension_picky",
  "0",
] as const;

/**
 * StreamEast's player page carries its playlist inline, base64-encoded and reversed:
 * `var streamUrl = (function(s){return atob(s).split('').reverse().join('')})('<base64>')`.
 * Only that exact transform is decoded; anything else is left to the other extractors.
 */
const REVERSED_BASE64_STREAM_URL =
  /\bstreamUrl\s?=\s?\(function\(s\)\{return atob\(s\)\.split\(''\)\.reverse\(\)\.join\(''\)\}\)\('([A-Za-z0-9+/]+={0,2})'\)/g;

/** A playlist URL is printable ASCII, so reversing by index cannot split a character. */
const PRINTABLE_ASCII = /^[\u{21}-\u{7E}]+$/u;

function reversedBase64StreamUrls(html: string): string[] {
  return [...html.matchAll(REVERSED_BASE64_STREAM_URL)].flatMap((match) => {
    const encoded = match[1];
    if (encoded === undefined) return [];
    let decoded: string;
    try {
      decoded = atob(encoded);
    } catch {
      return [];
    }
    if (!PRINTABLE_ASCII.test(decoded)) return [];
    return [
      Array.from(
        { length: decoded.length },
        (_, index) => decoded[decoded.length - 1 - index],
      ).join(""),
    ];
  });
}

function normalizeEmbeddedHtml(html: string): string {
  return html
    .replaceAll(String.raw`\u0026`, "&")
    .replaceAll(String.raw`\u003d`, "=")
    .replaceAll("&amp;", "&")
    .replaceAll(String.raw`\/`, "/");
}

function hlsUrls(html: string, pageUrl: string): URL[] {
  const normalized = normalizeEmbeddedHtml(html);
  const candidates = [
    ...[...normalized.matchAll(STREAM_URL)].map((match) => match[0]),
    ...reversedBase64StreamUrls(html),
  ].map((raw) => {
    const withProtocol = raw.startsWith("//") ? `https:${raw}` : raw;
    try {
      return new URL(withProtocol, pageUrl);
    } catch {
      return null;
    }
  });
  return candidates.flatMap((candidate) => {
    if (candidate === null) return [];
    const checked = validPublicHttpsUrl(
      candidate.toString(),
      allowedStreamHost,
    );
    return checked === null ? [] : [checked];
  });
}

function iframeUrls(html: string, pageUrl: string): URL[] {
  const tags = html.match(/<iframe\b[^>]*>/gi) ?? [];
  return tags.flatMap((tag) => {
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src === undefined) return [];
    let absolute: string;
    try {
      absolute = new URL(src, pageUrl).toString();
    } catch {
      return [];
    }
    const url = validPublicHttpsUrl(absolute, allowedPageHost);
    return url === null ? [] : [url];
  });
}

function titleFromHtml(html: string, fallbackUrl: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (match !== undefined) {
    const title = match
      .replaceAll(/<[^>]*>/g, "")
      .replaceAll("&amp;", "&")
      .replaceAll(/\s+/g, " ")
      .trim();
    const stripped = title.replace(
      /\s*[|–-]\s*(?:StreamEast|TvSportsLive).*$/i,
      "",
    );
    if (stripped.length > 0) return stripped;
  }
  const slug = new URL(fallbackUrl).pathname
    .split("/")
    .findLast(Boolean)
    ?.replace(/-\d+$/, "")
    .replaceAll("-", " ");
  return slug === undefined || slug.length === 0 ? "Live sports" : slug;
}

type FindHlsContext = {
  readonly visited: Set<string>;
  readonly signal: AbortSignal;
  readonly sourceHtml: string;
};

type ResolvedHls = {
  readonly input: URL;
  readonly headers: Readonly<Record<string, string>>;
};

export class BrowserSportsResolver implements SportsResolver {
  constructor(private readonly browser: SportsPageRenderer) {}

  async resolve(
    sourceUrl: string,
    signal: AbortSignal,
  ): Promise<{
    title: string;
    input: string;
    headers: Readonly<Record<string, string>>;
    inputOptions?: readonly string[];
  }> {
    const page = validPublicHttpsUrl(
      sourceUrl,
      (host) => host === "v2.streameast.ga" || host === "tvsportslive.fr",
    );
    if (page === null) {
      throw new Error("Sports watch-page URL is not an approved HTTPS source");
    }
    const sourceHtml = await this.browser.html(page.toString(), signal);
    const result = await this.findHls(page, {
      visited: new Set<string>(),
      signal,
      sourceHtml,
    });
    if (result === null) {
      throw new Error(
        "No supported live HLS stream was available on this event page",
      );
    }
    return {
      title: titleFromHtml(sourceHtml, sourceUrl),
      input: result.input.toString(),
      headers: result.headers,
      ...(disguisedSegmentHost(result.input.hostname)
        ? { inputOptions: DISGUISED_SEGMENT_HLS_INPUT_OPTIONS }
        : {}),
    };
  }

  private async findHls(
    page: URL,
    context: FindHlsContext,
    depth = 0,
  ): Promise<ResolvedHls | null> {
    if (depth > MAX_EMBED_DEPTH || context.visited.has(page.toString())) {
      return null;
    }
    context.visited.add(page.toString());
    if (page.hostname === "embed.st") {
      return await this.runtimeHls(page, context.signal, tvSportsStreamHost);
    }
    const html =
      depth === 0
        ? context.sourceHtml
        : await this.browser.html(page.toString(), context.signal);
    const direct = hlsUrls(html, page.toString())[0];
    if (direct !== undefined) {
      return {
        input: direct,
        headers: { Referer: page.toString() },
      };
    }
    if (page.hostname === "streame.center") {
      // Inspecting its nested player as a top-level page loses the browser
      // frame context and can change the site's Referer-dependent response.
      // PinchTab's network capture above covers requests from its subframes.
      return await this.runtimeHls(page, context.signal, allowedStreamHost);
    }
    for (const frame of iframeUrls(html, page.toString())) {
      const result = await this.findHls(frame, context, depth + 1);
      if (result !== null) return result;
    }
    return null;
  }

  private async runtimeHls(
    page: URL,
    signal: AbortSignal,
    allowedHost: (host: string) => boolean,
  ): Promise<ResolvedHls | null> {
    const runtime = await this.browser.runtimeStreams(page.toString(), signal);
    for (const resource of runtime.resources) {
      const input = validPublicHttpsUrl(resource, allowedHost);
      if (input !== null) return { input, headers: runtime.headers };
    }
    return null;
  }
}

export function sportsEventForSource(sourceUrl: string): SportsEvent | null {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return null;
    if (
      url.hostname === "lolesports.com" &&
      /^\/en-US\/leagues\/(?:lck|worlds|msi|first_stand|lpl|lec|lcs)$/.test(
        url.pathname,
      ) &&
      /^#\d+$/.test(url.hash)
    ) {
      return SportsEventSchema.parse({
        id: `lolesports:${url.hash.slice(1)}`,
        provider: "lolesports",
        title: "LoL Esports",
        status: "unknown",
        startsAt: null,
        pageUrl: sourceUrl,
      });
    }
    if (url.hostname === "v2.streameast.ga") {
      return SportsEventSchema.parse({
        id: `streameast:${url.pathname}`,
        provider: "streameast",
        title: titleFromHtml("", sourceUrl),
        status: "live",
        startsAt: null,
        pageUrl: sourceUrl,
      });
    }
    if (url.hostname === "tvsportslive.fr") {
      return SportsEventSchema.parse({
        id: `tvsportslive:${url.pathname}`,
        provider: "tvsportslive",
        title: titleFromHtml("", sourceUrl),
        status: "live",
        startsAt: null,
        pageUrl: sourceUrl,
      });
    }
    return null;
  } catch {
    return null;
  }
}
