import { Bookmark } from "../model/Bookmark";

export interface BookmarkDatastore {
  add(bookmark: Bookmark): void;
  get(): Bookmark[];
  remove(bookmark: Bookmark): void;
}
