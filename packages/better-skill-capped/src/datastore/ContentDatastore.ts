import { Content } from "../model/Content";

export interface ContentDatastore {
  set(content: Content): void;
  get(): Content;
}
