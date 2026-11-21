import type { BrowsePage } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";

/**
 * The whole album as one playable item: Listen and Watch queue every track in order. `null` for
 * artists, and for an album the server offers no way to play.
 */
export function albumPlayItem(page: BrowsePage): MediaItem | null {
  if (page.play === undefined || page.play.actions.length === 0) return null;
  const { actions } = page.play;
  // Like a song row: Listen is the button and Watch moves to the menu.
  const songLike = actions.includes("listen") && actions.includes("watch");
  return {
    key: "album:" + page.play.id,
    kind: "album",
    title: page.header.title,
    actions: songLike ? ["listen"] : actions,
    ...(songLike ? { menuActions: ["watch"] } : {}),
    selection: { kind: "music", id: page.play.id },
  };
}
