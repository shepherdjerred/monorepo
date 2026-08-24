import {
  buildManagedFreshRssOpml,
  parseFreshRssOpml,
} from "./freshrss-opml.ts";

export const FRESHRSS_SOURCE_OPML = await Bun.file(
  new URL("../../helm/freshrss/feeds.opml", import.meta.url),
).text();
export const FRESHRSS_DESIRED_MANIFEST =
  parseFreshRssOpml(FRESHRSS_SOURCE_OPML);
export const FRESHRSS_DESIRED_JSON = `${JSON.stringify(FRESHRSS_DESIRED_MANIFEST, null, 2)}\n`;
export const FRESHRSS_REPO_STACK_OPML = buildManagedFreshRssOpml(
  FRESHRSS_DESIRED_MANIFEST,
);
