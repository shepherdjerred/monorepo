import type { Bookmark } from "#src/model/bookmark";

export type BookmarkDatastore = {
  add: (bookmark: Bookmark) => void;
  get: () => Bookmark[];
  remove: (bookmark: Bookmark) => void;
}
