import {
  SportsEventSchema,
  type SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";

export const SPORTS_TIME_ZONE = "America/Los_Angeles";
export const STREAMEAST_HOME = "https://v2.streameast.ga/";
export const TVSPORTSLIVE_HOME = "https://tvsportslive.fr/";

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SPORTS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Could not format the sports listing date");
  }
  return `${year}-${month}-${day}`;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(String.raw`\b${name}="([^"]*)"`, "i").exec(tag);
  return match?.[1];
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function toPageUrl(base: string, href: string): string | null {
  try {
    const url = new URL(decodeHtml(href), base);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== new URL(base).hostname) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function eventsForCurrentLocalDay(
  events: readonly SportsEvent[],
  now: Date,
): SportsEvent[] {
  const today = localDateKey(now);
  return events.filter(
    (event) =>
      event.startsAt === null ||
      localDateKey(new Date(event.startsAt)) === today,
  );
}

/** Parse the public event cards rendered on StreamEast's home page. */
export function parseStreamEastEvents(
  html: string,
  now: Date = new Date(),
): SportsEvent[] {
  const cards = html.match(
    /<div[^>]+class="m-card\b[^>]*>[\s\S]*?(?=<div[^>]+class="m-card\b|$)/gi,
  );
  if (cards === null) return [];

  const events = cards.flatMap((card): SportsEvent[] => {
    const link = /<a[^>]+class="m-card__link"[^>]*>/i.exec(card)?.[0];
    if (link === undefined) return [];
    const href = attribute(link, "href");
    const title = attribute(link, "aria-label");
    if (href === undefined || title === undefined) return [];
    const pageUrl = toPageUrl(STREAMEAST_HOME, href);
    if (pageUrl === null) return [];

    const rawStart = attribute(card.slice(0, card.indexOf(link)), "data-time");
    const epochSeconds = rawStart === undefined ? Number.NaN : Number(rawStart);
    const startsAt = Number.isFinite(epochSeconds)
      ? new Date(epochSeconds * 1000).toISOString()
      : null;
    const id =
      attribute(card.slice(0, card.indexOf(link)), "data-match-id") ??
      new URL(pageUrl).pathname;

    return SportsEventSchema.safeParse({
      id: `streameast:${id}`,
      provider: "streameast",
      title: decodeHtml(title).trim(),
      status: /m-card--live\b/i.test(card) ? "live" : "scheduled",
      startsAt,
      pageUrl,
    }).success
      ? [
          SportsEventSchema.parse({
            id: `streameast:${id}`,
            provider: "streameast",
            title: decodeHtml(title).trim(),
            status: /m-card--live\b/i.test(card) ? "live" : "scheduled",
            startsAt,
            pageUrl,
          }),
        ]
      : [];
  });
  return eventsForCurrentLocalDay(events, now);
}

function parsePostedDate(section: string): string | null {
  const machineDate = /datetime="(\d{4}-\d{2}-\d{2})[^"]*"/i.exec(section)?.[1];
  if (machineDate !== undefined) return machineDate;
  const textDate = /(?:Posted on\s*)?([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/.exec(
    section,
  )?.[1];
  if (textDate === undefined) return null;
  const parsed = new Date(textDate);
  return Number.isNaN(parsed.valueOf())
    ? null
    : parsed.toISOString().slice(0, 10);
}

/** Parse dated WordPress event posts; this provider does not publish reliable kickoff times. */
export function parseTVSportsLiveEvents(
  html: string,
  now: Date = new Date(),
): SportsEvent[] {
  const headings = [
    ...html.matchAll(
      /<h[1-4][^>]+class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-4]>/gi,
    ),
  ];
  const today = localDateKey(now);
  const events = headings.flatMap((heading, index): SportsEvent[] => {
    const href = heading[1];
    const rawTitle = heading[2]?.replaceAll(/<[^>]*>/g, "");
    if (href === undefined || rawTitle === undefined) return [];
    const start = heading.index;
    const next = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, next);
    const postedDate = parsePostedDate(section);
    // The provider's home feed is its current-day listing. Older, dated posts are excluded.
    if (postedDate !== null && postedDate !== today) return [];
    const pageUrl = toPageUrl(TVSPORTSLIVE_HOME, href);
    if (pageUrl === null) return [];
    const title = decodeHtml(rawTitle.replaceAll(/\s+/g, " ")).trim();
    if (title.length === 0) return [];
    const live = /\b(?:live now|currently live)\b/i.test(section);
    const parsed = SportsEventSchema.safeParse({
      id: `tvsportslive:${new URL(pageUrl).pathname}`,
      provider: "tvsportslive",
      title,
      status: live ? "live" : "scheduled",
      startsAt: null,
      pageUrl,
    });
    return parsed.success ? [parsed.data] : [];
  });
  return events;
}

export function sportsEventTimeLabel(event: SportsEvent): string {
  if (event.status === "live") return "LIVE";
  if (event.startsAt === null) return "Later today";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SPORTS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startsAt));
}

export function sortSportsEvents(
  events: readonly SportsEvent[],
): SportsEvent[] {
  return [...events].sort((left, right) => {
    if (left.status !== right.status) return left.status === "live" ? -1 : 1;
    if (left.startsAt === null) return right.startsAt === null ? 0 : 1;
    return right.startsAt === null
      ? -1
      : left.startsAt.localeCompare(right.startsAt);
  });
}
