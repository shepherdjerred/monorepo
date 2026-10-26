import type { z } from "zod";
import type { CapturePrivacyOmissionSchema } from "./contract.ts";
import { InstalledCaptureSchema, type InstalledCapture } from "./contract.ts";
import { PrivateCaptureContentError } from "./diagnostics.ts";
import { assertPrivateCaptureContent } from "./private.ts";

function assertNoCredentialLiteral(
  value: unknown,
  credentials: readonly string[],
  path: readonly PropertyKey[] = [],
) {
  if (
    typeof value === "string" &&
    credentials.some((secret) => secret.length > 0 && value.includes(secret))
  )
    throw new PrivateCaptureContentError(path, "credential_literal");
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoCredentialLiteral(item, credentials, [...path, index]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      assertNoCredentialLiteral(item, credentials, [...path, key]);
  }
}

/** Only after full literal two-pass equality; this never invents identity or modifies source profiles. */
export function omitPrivateEpisodeTitles(
  capture: InstalledCapture,
  credentials: readonly string[],
) {
  assertNoCredentialLiteral(capture, credentials);
  if (capture.source === "radarr") return capture;
  const privacyOmissions: z.infer<typeof CapturePrivacyOmissionSchema>[] = [
    ...capture.privacyOmissions,
  ];
  const episodes = capture.episodes.map((episode) => {
    if (episode.title === undefined || episode.title === null) return episode;
    try {
      assertPrivateCaptureContent(episode.title, credentials);
      return episode;
    } catch (error) {
      if (
        !(error instanceof PrivateCaptureContentError) ||
        !(
          error.content.subreason === "credential_pattern" ||
          error.content.subreason === "url_value"
        )
      )
        throw error;
      privacyOmissions.push({
        source: "sonarr",
        resource: "episode",
        resourceId: episode.id,
        field: "title",
        reason: error.content.subreason,
      });
      const retained = { ...episode };
      delete retained.title;
      return retained;
    }
  });
  return InstalledCaptureSchema.parse({
    ...capture,
    episodes,
    privacyOmissions,
  });
}
