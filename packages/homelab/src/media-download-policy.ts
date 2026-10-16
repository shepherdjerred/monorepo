import { z } from "zod";
import policy from "./media-download-policy.json" with { type: "json" };

const ApplicationSchema = z.strictObject({
  category: z.string().min(1),
  url: z.url(),
});

export const MediaDownloadPolicySchema = z.strictObject({
  dangerousExtensions: z.array(z.string().regex(/^\.[a-z0-9]+$/u)).min(1),
  downloadRoot: z.literal("/downloads"),
  applications: z.strictObject({
    sonarr: ApplicationSchema,
    radarr: ApplicationSchema,
  }),
  qbittorrentUrl: z.url(),
});

export const mediaDownloadPolicy = MediaDownloadPolicySchema.parse(policy);

/** Qt serializes a QStringList as comma-separated wildcard patterns. */
export const excludedMediaFileNames = mediaDownloadPolicy.dangerousExtensions
  .map((extension) => `*${extension}`)
  .join(", ");
