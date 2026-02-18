import { z } from "zod";
import type { BookmarkDatastore } from "./bookmark-datastore.ts";
import type { Bookmark, Bookmarkable } from "#src/model/bookmark";
import type { Content } from "#src/model/content";
import { isCommentary } from "#src/model/commentary";
import { isVideo } from "#src/model/video";
import { isCourse } from "#src/model/course";

const IDENTIFIER = "bookmarks";

const StoredBookmarkSchema = z.object({
  item: z.object({ uuid: z.string() }).passthrough(),
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

      if (isCommentary(bookmark.item)) {
        matchedItem = this.content.commentaries.find((commentary) => {
          return commentary.uuid === bookmark.item.uuid;
        });
      } else if (isCourse(bookmark.item)) {
        matchedItem = this.content.courses.find((course) => {
          return course.uuid === bookmark.item.uuid;
        });
      } else if (isVideo(bookmark.item)) {
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
