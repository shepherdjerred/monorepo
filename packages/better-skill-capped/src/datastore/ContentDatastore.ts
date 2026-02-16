import type { Content } from "@shepherdjerred/better-skill-capped/model/Content";

export type ContentDatastore = {
  set: (content: Content) => void;
  get: () => Content;
}
