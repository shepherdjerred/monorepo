import type { Bookmark } from "@shepherdjerred/better-skill-capped/model/Bookmark";

export type BookmarkDatastore = {
  add: (bookmark: Bookmark) => void;
  get: () => Bookmark[];
  remove: (bookmark: Bookmark) => void;
}
