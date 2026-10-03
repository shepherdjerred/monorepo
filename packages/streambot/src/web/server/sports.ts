import type {
  SportsCatalog,
  SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";
import { matchSportsEvents } from "@shepherdjerred/streambot/sports/sports-service.ts";
import { SportsQuerySchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Selections } from "./selections.ts";
import { WebError, requestInput } from "./errors.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

export class WebSports {
  private readonly selections = new Selections<SportsEvent>();
  private readonly titles = new Map<string, string>();
  constructor(private readonly catalog: SportsCatalog | undefined) {}

  async browse(params: URLSearchParams, owner: string, signal: AbortSignal) {
    const query = requestInput(SportsQuerySchema, Object.fromEntries(params));
    if (this.catalog === undefined)
      throw new WebError(
        503,
        "sports_unavailable",
        "Live sports listings are temporarily unavailable.",
      );
    const today = await this.catalog.listToday(signal, query.provider);
    const filtered = today.filter(
      (event) => query.provider === "auto" || event.provider === query.provider,
    );
    const events =
      query.query === "" ? filtered : searchEvents(query.query, filtered);
    for (const event of events) {
      if (this.titles.size >= 2000 && !this.titles.has(event.pageUrl)) {
        const oldest = this.titles.keys().next().value;
        if (oldest !== undefined) this.titles.delete(oldest);
      }
      this.titles.set(event.pageUrl, event.title);
    }
    return events.slice(0, 50).map((event) => ({
      id: this.selections.add(owner, event),
      title: event.title,
      provider: event.provider,
      status: event.status,
      startsAt: event.startsAt,
    }));
  }

  title(source: Source | undefined): string | undefined {
    return source?.kind === "url" ? this.titles.get(source.url) : undefined;
  }

  select(id: string, owner: string) {
    const event = this.selections.get(owner, id);
    if (event.status === "scheduled")
      throw new WebError(
        409,
        "sports_upcoming",
        "This event is not live yet. Refresh the listings when it starts.",
      );
    return {
      source: {
        kind: "url" as const,
        url: event.pageUrl,
        mode: "video" as const,
      },
      title: event.title,
    };
  }
}

function searchEvents(
  query: string,
  events: readonly SportsEvent[],
): readonly SportsEvent[] {
  const result = matchSportsEvents(query, events, "auto");
  switch (result.kind) {
    case "not-found":
      return [];
    case "upcoming":
      return [result.event];
    case "found":
    case "ambiguous":
      return result.events;
  }
}
