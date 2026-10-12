import { z } from "zod";

export const SPORTS_ARTWORK_HOST = "v2.streameast.ga";

export function isSportsArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === SPORTS_ARTWORK_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      /^\/images\/(?:cat\/)?[\w-]+\.(?:svg|png|webp|jpe?g)$/u.test(
        url.pathname,
      ) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export const SportsArtworkSchema = z.strictObject({
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
