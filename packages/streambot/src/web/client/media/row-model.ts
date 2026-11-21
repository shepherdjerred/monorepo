import {
  selectionForRow,
  type Row,
  type RowAction,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { SportsArtworkSchema } from "@shepherdjerred/streambot/sports/artwork.ts";
import type { z } from "zod";
import type { MediaSelection } from "@shepherdjerred/streambot/web/client/commands.ts";
import { formatTime } from "@shepherdjerred/streambot/web/client/room/position.ts";

/**
 * Everything one media row or card renders. Search rows, history, live games, playlists and
 * library titles all become this shape, so one component draws every list in the remote.
 */
export type MediaItem = {
  readonly key: string;
  readonly kind: Row["kind"] | "playlist" | "series";
  readonly title: string;
  readonly subtitle?: string;
  readonly durationSeconds?: number;
  readonly artworkUrl?: string;
  readonly sportsArtwork?: z.infer<typeof SportsArtworkSchema>;
  readonly status?: "live" | "scheduled" | "unknown";
  readonly startsAt?: string;
  /** The play buttons, first first. Empty for items that only open a page. */
  readonly actions: readonly RowAction[];
  /** Destinations offered only from the overflow menu (for a song, Watch the video). */
  readonly menuActions?: readonly RowAction[];
  readonly selection: MediaSelection | null;
  /** In-app page this item opens instead of, or as well as, playing. */
  readonly href?: string;
  /** 1-based position in the result group that listed it; analytics reports only a bucket. */
  readonly rank?: number;
};

export function rowItem(row: Row): MediaItem {
  return {
    key: row.kind + ":" + row.id,
    kind: row.kind,
    title: row.title,
    ...(row.subtitle === undefined ? {} : { subtitle: row.subtitle }),
    ...(row.durationSeconds === undefined
      ? {}
      : { durationSeconds: row.durationSeconds }),
    ...(row.artworkUrl === undefined ? {} : { artworkUrl: row.artworkUrl }),
    ...(row.sportsArtwork === undefined
      ? {}
      : { sportsArtwork: row.sportsArtwork }),
    ...(row.status === undefined ? {} : { status: row.status }),
    ...(row.startsAt === undefined ? {} : { startsAt: row.startsAt }),
    actions: row.actions,
    ...(row.menuActions === undefined ? {} : { menuActions: row.menuActions }),
    selection: selectionForRow(row),
    ...(row.browse === undefined
      ? {}
      : {
          href: "/" + row.browse.kind + "/" + encodeURIComponent(row.browse.id),
        }),
  };
}

/** The quiet second line of a row: what it is, then how long it runs. */
export function itemDetail(item: MediaItem): string {
  const parts = [item.subtitle];
  if (item.durationSeconds !== undefined)
    parts.push(formatTime(item.durationSeconds));
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

export type EnterIntent =
  | { readonly kind: "play"; readonly action: RowAction }
  | { readonly kind: "focus-actions" }
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "none" };

/**
 * Enter on a focused row. With exactly one button it presses that button; with two, neither is
 * a default, so focus moves to the pair for the viewer to choose. Browse-only rows open their page.
 */
export function enterIntent(
  item: Pick<MediaItem, "actions" | "href">,
): EnterIntent {
  const [first, second] = item.actions;
  if (first !== undefined && second === undefined)
    return { kind: "play", action: first };
  if (first !== undefined) return { kind: "focus-actions" };
  return item.href === undefined
    ? { kind: "none" }
    : { kind: "open", href: item.href };
}
