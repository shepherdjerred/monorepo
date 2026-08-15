import { z } from "zod";
import type { BookmarkDatastore } from "./bookmark-datastore.ts";
import type { Bookmark, Bookmarkable } from "#src/model/bookmark";
import type { Content, Kind } from "#src/model/content";

// Stored bookmarks predate the `kind` discriminant, so raw items are
// classified by shape one last time; the storage v2 migration removes this.
function storedItemKind(item: Record<string, unknown>): Kind {
  if ("matchLink" in item) {
    return "commentary";
  }
  if ("videos" in item) {
    return "course";
  }
  return "video";
}

const IDENTIFIER = "bookmarks";

const StoredBookmarkSchema = z.object({
  item: z.object({ uuid: z.string() }).catchall(z.unknown()),
  date: z.string(),
});
const StoredBookmarksSchema = z.array(StoredBookmarkSchema);

export class LocalStorageBookmarkDatastore implements BookmarkDatastore {
  private readonly content: Content;

  constructor(content: Content) {
    this.content = content;
  }

  add(bookmark: Bookmark): void {
    const existingBookmarks = this.get();
    existingBookmarks.push(bookmark);
    existingBookmarks.sort(
      (left, right) => right.date.getTime() - left.date.getTime(),
    );
    this.set(existingBookmarks);
  }

  get(): Bookmark[] {
    const raw: unknown = JSON.parse(
      globalThis.localStorage.getItem(IDENTIFIER) ?? "[]",
    );
    const bookmarks = StoredBookmarksSchema.parse(raw);
    const updatedBookmarks: Bookmark[] = bookmarks.flatMap((bookmark) => {
      let matchedItem: Bookmarkable | undefined;

      const kind = storedItemKind(bookmark.item);
      if (kind === "commentary") {
        matchedItem = this.content.commentaries.find((commentary) => {
          return commentary.uuid === bookmark.item.uuid;
        });
      } else if (kind === "course") {
        matchedItem = this.content.courses.find((course) => {
          return course.uuid === bookmark.item.uuid;
        });
      } else {
        matchedItem = this.content.videos.find((video) => {
          return video.uuid === bookmark.item.uuid;
        });
      }

      if (matchedItem === undefined) {
        console.warn(
          `Couldn't find matching item for bookmark ${JSON.stringify(bookmark)}`,
        );
        return [];
      } else {
        return {
          ...bookmark,
          item: matchedItem,
          date: new Date(bookmark.date),
        };
      }
    });
    return updatedBookmarks;
  }

  remove(bookmark: Bookmark): void {
    const filteredBookmarks = this.get().filter((candidate: Bookmark) => {
      return (
        candidate !== bookmark && candidate.item.uuid !== bookmark.item.uuid
      );
    });
    this.set(filteredBookmarks);
  }

  private set(bookmarks: Bookmark[]) {
    globalThis.localStorage.setItem(IDENTIFIER, JSON.stringify(bookmarks));
  }
}
