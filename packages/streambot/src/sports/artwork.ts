import { z } from "zod";

export const SPORTS_ARTWORK_HOST = "v2.streameast.ga";
export const LOL_ARTWORK_HOST = "static.lolesports.com";

export function isSportsThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      ((url.hostname === "i.ytimg.com" &&
        /^\/vi\/[\w-]{11}\/hqdefault\.jpg$/u.test(url.pathname)) ||
        (url.hostname === "static-cdn.jtvnw.net" &&
          /^\/previews-ttv\/live_user_\w+-440x248\.jpg$/u.test(url.pathname)))
    );
  } catch {
    return false;
  }
}

export function isSportsArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [SPORTS_ARTWORK_HOST, LOL_ARTWORK_HOST].includes(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      (url.hostname === LOL_ARTWORK_HOST
        ? /^\/(?:teams|leagues)\/[^/]+\.(?:svg|png|webp|jpe?g)$/u.test(
            url.pathname,
          )
        : /^\/images\/(?:cat\/)?[\w-]+\.(?:svg|png|webp|jpe?g)$/u.test(
            url.pathname,
          )) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export const SportsArtworkSchema = z.strictObject({
  thumbnailUrl: z.string().refine(isSportsThumbnailUrl).optional(),
  teams: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        logoUrl: z.string().refine(isSportsArtworkUrl).optional(),
      }),
    )
    .max(2),
  league: z
    .strictObject({
      name: z.string().min(1),
      logoUrl: z.string().refine(isSportsArtworkUrl).optional(),
    })
    .optional(),
});
export type SportsArtwork = z.infer<typeof SportsArtworkSchema>;
