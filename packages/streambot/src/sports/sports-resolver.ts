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
  return host === "streame.center" || /^edgestream\d+\.pro$/.test(host);
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
  const candidates = [...normalized.matchAll(STREAM_URL)].map((match) => {
    const raw = match[0];
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

export class BrowserSportsResolver implements SportsResolver {
  constructor(private readonly browser: SportsPageRenderer) {}

  async resolve(
    sourceUrl: string,
    signal: AbortSignal,
  ): Promise<{
    title: string;
    input: string;
    headers: Readonly<Record<string, string>>;
  }> {
    const page = validPublicHttpsUrl(
      sourceUrl,
      (host) => host === "v2.streameast.ga" || host === "tvsportslive.fr",
    );
    if (page === null) {
      throw new Error("Sports watch-page URL is not an approved HTTPS source");
    }
    const visited = new Set<string>();
    const result = await this.findHls(page, 0, visited, signal);
    if (result === null) {
      throw new Error(
        "No supported live HLS stream was available on this event page",
      );
    }
    return {
      title: titleFromHtml(result.html, sourceUrl),
      input: result.input.toString(),
      headers: { Referer: result.referer },
    };
  }

  private async findHls(
    page: URL,
    depth: number,
    visited: Set<string>,
    signal: AbortSignal,
  ): Promise<{ input: URL; referer: string; html: string } | null> {
    if (depth > MAX_EMBED_DEPTH || visited.has(page.toString())) return null;
    visited.add(page.toString());
    const html = await this.browser.html(page.toString(), signal);
    const direct = hlsUrls(html, page.toString())[0];
    if (direct !== undefined) {
      return { input: direct, referer: page.toString(), html };
    }
    for (const frame of iframeUrls(html, page.toString())) {
      const result = await this.findHls(frame, depth + 1, visited, signal);
      if (result !== null) return result;
    }
    return null;
  }
}

export function sportsEventForSource(sourceUrl: string): SportsEvent | null {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return null;
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
