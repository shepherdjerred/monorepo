import type { Content } from "#src/model/content";

export type ContentDatastore = {
  set: (content: Content) => void;
  get: () => Content;
}
