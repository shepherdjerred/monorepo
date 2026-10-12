import { z } from "zod";
import { parseJson } from "@shepherdjerred/streambot/util/errors.ts";
import {
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
export type YtdlpSearchResult = {
  readonly title: string;
  readonly url: string;
  readonly channel?: string;
  readonly thumbnailUrl?: string;
  readonly durationSeconds?: number;
};
const YtdlpSearchResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  webpage_url: z.string().nullish(),
  url: z.string().nullish(),
  channel: z.string().nullish(),
  uploader: z.string().nullish(),
  thumbnail: z.string().nullish(),
  thumbnails: z
    .array(
      z.object({
        url: z.string(),
        width: z.number().nullish(),
        height: z.number().nullish(),
      }),
    )
    .nullish(),
  duration: z.number().nullish(),
});

export function parseYoutubeSearchLine(line: string): YtdlpSearchResult | null {
  const parsed = YtdlpSearchResultSchema.parse(parseJson(line));
  const candidateUrl = parsed.webpage_url ?? parsed.url;
  const url =
    candidateUrl?.startsWith("http") === true
      ? candidateUrl
      : `https://www.youtube.com/watch?v=${parsed.id}`;
  if (isBlockedText(parsed.title) || isBlockedUrl(url)) return null;
  const channel = parsed.channel ?? parsed.uploader;
  const thumbnail = [
    parsed.thumbnail,
    ...(parsed.thumbnails
      ?.toSorted((a, b) => (b.width ?? 0) - (a.width ?? 0))
      .map((item) => item.url) ?? []),
  ].find((value) => typeof value === "string" && isRemoteArtworkUrl(value));
  return {
    title: parsed.title,
    url,
    ...(channel == null ? {} : { channel }),
    ...(thumbnail == null ? {} : { thumbnailUrl: thumbnail }),
    ...(parsed.duration == null ? {} : { durationSeconds: parsed.duration }),
  };
}
