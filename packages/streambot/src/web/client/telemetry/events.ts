import { z } from "zod";
import { WEB_API_ERROR_CODES } from "@shepherdjerred/streambot/web/shared/error-codes.ts";
import { CLIENT_ERROR_CODES } from "@shepherdjerred/streambot/web/client/messages.ts";
import type { RowAction } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { Placement } from "@shepherdjerred/streambot/web/client/commands.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { routePattern, type RoutePattern } from "./privacy.ts";

/**
 * The browser's product events. Each builder returns a closed property set — enums, buckets and
 * route patterns only — so no title, query, URL, name or Discord id can reach PostHog from here.
 */
export type TelemetryEvent =
  | {
      readonly event: "$pageview";
      readonly properties: {
        readonly $current_url: string;
        readonly $pathname: RoutePattern;
        readonly route: RoutePattern;
      };
    }
  | {
      readonly event: "streambot_result_chosen";
      readonly properties: {
        readonly kind: MediaItem["kind"];
        readonly rank_bucket: RankBucket;
        readonly offered: Offered;
        readonly button: PlayButton;
      };
    }
  | {
      readonly event: "streambot_error_shown";
      readonly properties: {
        readonly code: ErrorCode;
        readonly surface: FailureSurface;
      };
    };

/** A page view reports the route pattern on this site's origin, never the concrete path or query. */
export function pageViewEvent(
  pathname: string,
  siteOrigin: string,
): TelemetryEvent {
  const route = routePattern(pathname);
  return {
    event: "$pageview",
    properties: { $current_url: siteOrigin + route, $pathname: route, route },
  };
}

export type RankBucket = "1" | "2-3" | "4-10" | "11+" | "none";

/** Where a chosen row sat in its list (1-based), coarsened so it identifies nothing. */
export function rankBucket(rank: number | undefined): RankBucket {
  if (rank === undefined || !Number.isInteger(rank) || rank < 1) return "none";
  if (rank === 1) return "1";
  if (rank <= 3) return "2-3";
  return rank <= 10 ? "4-10" : "11+";
}

export type PlayButton =
  | "listen"
  | "watch"
  | "listen_next"
  | "watch_next"
  | "listen_now"
  | "watch_now"
  | "another_stream"
  | "watch_video"
  | "listen_only";

/** The play request a row's button or `⋯` menu item sends. */
export type PlayChoice = {
  readonly transport: RowAction;
  readonly placement: Placement;
  readonly anotherStream?: boolean;
};

/**
 * Which control started a play. A plain queue from the menu is one of the row's menu-only
 * destinations: "Watch the video" or "Listen only".
 */
export function playButton(fromMenu: boolean, choice: PlayChoice): PlayButton {
  if (choice.anotherStream === true) return "another_stream";
  switch (choice.placement) {
    case "next":
      return choice.transport === "listen" ? "listen_next" : "watch_next";
    case "now":
      return choice.transport === "listen" ? "listen_now" : "watch_now";
    case "queue":
      if (!fromMenu) return choice.transport;
      return choice.transport === "watch" ? "watch_video" : "listen_only";
  }
}

/** Which play buttons the chosen row showed, so Listen and Watch compare only where both were offered. */
export type Offered = "listen" | "watch" | "both" | "none";

export function offered(actions: readonly RowAction[]): Offered {
  const listen = actions.includes("listen");
  const watch = actions.includes("watch");
  if (listen && watch) return "both";
  if (listen) return "listen";
  return watch ? "watch" : "none";
}

export function resultChosenEvent(
  item: Pick<MediaItem, "kind" | "rank" | "actions">,
  button: PlayButton,
): TelemetryEvent {
  return {
    event: "streambot_result_chosen",
    properties: {
      kind: item.kind,
      rank_bucket: rankBucket(item.rank),
      offered: offered(item.actions),
      button,
    },
  };
}

/** Where a failure was shown. */
export type FailureSurface = "row" | "rail" | "search" | "page" | "dialog";

/**
 * Every code a shown failure may report: the web API's closed list from the shared contract plus
 * the client's own. The wire keeps `code` a free string, so anything else reports as `other`.
 */
const KnownCodeSchema = z.enum([...WEB_API_ERROR_CODES, ...CLIENT_ERROR_CODES]);
export type ErrorCode = z.infer<typeof KnownCodeSchema> | "other";

export function errorCode(code: string): ErrorCode {
  const known = KnownCodeSchema.safeParse(code);
  return known.success ? known.data : "other";
}

export function errorShownEvent(
  failure: { readonly code: string },
  surface: FailureSurface,
): TelemetryEvent {
  return {
    event: "streambot_error_shown",
    properties: { code: errorCode(failure.code), surface },
  };
}
