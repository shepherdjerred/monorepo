import { z } from "zod";

export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  image: z
    .string()
    .regex(/^plexinc\/pms-docker:[^@]+-amd64@sha256:[a-f0-9]{64}$/u),
  version: z.string().min(1),
  ffmpegVersion: z.string().min(1),
  root: z.string().startsWith("/"),
  files: z
    .array(
      z.strictObject({
        kind: z.enum(["movie", "show"]),
        path: z.string().startsWith("/"),
        size: z.int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        edition: z.string().nullable(),
        episodes: z.array(z.int().positive()),
      }),
    )
    .length(5),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Generated patterns only; names are test labels, not claims of movie content. */
export const FIXTURES = [
  {
    kind: "movie",
    filename: "Plex Synthetic Fixture (2026)/Plex Synthetic Fixture (2026).mp4",
    edition: null,
    episodes: [],
  },
  {
    kind: "movie",
    filename:
      "Plex Synthetic Fixture (2026) {edition-Director's Cut}/Plex Synthetic Fixture (2026) {edition-Director's Cut}.mp4",
    edition: "Director's Cut",
    episodes: [],
  },
  {
    kind: "movie",
    filename:
      "Plex Synthetic Fixture (2026) {edition-Extended Cut}/Plex Synthetic Fixture (2026) {edition-Extended Cut}.mp4",
    edition: "Extended Cut",
    episodes: [],
  },
  {
    kind: "show",
    filename:
      "Plex Synthetic Series (2026)/Season 01/Plex Synthetic Series (2026) - S01E01.mp4",
    edition: null,
    episodes: [1],
  },
  {
    kind: "show",
    filename:
      "Plex Synthetic Series (2026)/Season 01/Plex Synthetic Series (2026) - S01E02-E03.mp4",
    edition: null,
    episodes: [2, 3],
  },
] as const;
