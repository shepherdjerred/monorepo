import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** Thrown when a requested or resolved source is an adult/porn source. */
export class BlockedSourceError extends Error {
  constructor(reason: string) {
    super(`blocked adult source: ${reason}`);
    this.name = "BlockedSourceError";
  }
}

/**
 * Registrable domains of well-known adult sites. Matched precisely (exact host or a subdomain of
 * the domain) so innocuous hosts like `popcorn.com` are never caught by a naive `"porn"` substring.
 */
const ADULT_DOMAINS: readonly string[] = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "redtube.com",
  "xhamster.com",
  "youporn.com",
  "spankbang.com",
  "spankwire.com",
  "tube8.com",
  "thumbzilla.com",
  "tnaflix.com",
  "porntrex.com",
  "eporner.com",
  "hqporner.com",
  "onlyfans.com",
  "fansly.com",
  "brazzers.com",
  "chaturbate.com",
  "stripchat.com",
  "bongacams.com",
  "cam4.com",
  "myfreecams.com",
  "fapello.com",
  "motherless.com",
  "javhd.com",
  "rule34.xxx",
  "nhentai.net",
  "e-hentai.org",
  "hentaihaven.xxx",
];

/** Distinctive adult tokens for query/title checks — word-boundary matched to avoid false hits. */
const ADULT_TOKENS: readonly string[] = [
  "porn",
  "pornographic",
  "xxx",
  "hentai",
  "nsfw",
  "camgirl",
  "blowjob",
  "deepthroat",
  "creampie",
  "cumshot",
  "milf",
  "bukkake",
  "gangbang",
];

function registrableMatch(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True if a hostname belongs to a known adult site. */
export function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/u, "");
  return ADULT_DOMAINS.some((domain) => registrableMatch(normalized, domain));
}

/** True if a URL points at a known adult site (false for unparseable input). */
export function isBlockedUrl(value: string): boolean {
  try {
    return isBlockedHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** True if free text (a search query or video title) contains a distinctive adult token. */
export function isBlockedText(text: string): boolean {
  const lower = text.toLowerCase();
  return ADULT_TOKENS.some((token) =>
    new RegExp(String.raw`\b${token}\b`, "u").test(lower),
  );
}

/** True if a requested {@link Source} is obviously adult before resolution. */
export function isBlockedSource(source: Source): boolean {
  switch (source.kind) {
    case "url": {
      return isBlockedUrl(source.url);
    }
    case "search": {
      return isBlockedText(source.query);
    }
    case "file": {
      return false;
    }
  }
}

const SHAME_LINES: readonly string[] = [
  "Absolutely not. There are kids on this server.",
  "There are kids on this server. Touch grass.",
  "There are kids on this server — and now everyone knows what you tried to queue.",
  "There are kids on this server. Maybe rethink your life choices.",
  "There are kids on this server. The audacity.",
];

/** A public, cheeky shaming message that names the offending user. */
export function shameMessage(
  userId: UserId,
  picker: () => number = Math.random,
): string {
  const line =
    SHAME_LINES[Math.floor(picker() * SHAME_LINES.length)] ?? SHAME_LINES[0];
  return `🚫 <@${userId}> ${line ?? ""}`.trim();
}
