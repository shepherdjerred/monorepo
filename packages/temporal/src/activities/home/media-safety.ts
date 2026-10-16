import { Context, log } from "@temporalio/activity";
import { z } from "zod";
import { runMediaSafety } from "#lib/media-safety/guard.ts";
import { mediaSafetyEnabled } from "#config/media-safety.ts";
import {
  mediaSafetyLastSuccess,
  mediaSafetyRejected,
} from "#observability/metrics-media-safety.ts";

const CredentialsSchema = z.object({
  SONARR_API_KEY: z.string().min(1),
  RADARR_API_KEY: z.string().min(1),
  QBITTORRENT_USERNAME: z.string().min(1),
  QBITTORRENT_PASSWORD: z.string().min(1),
});

export async function inspectMediaDownloadSafety() {
  const credentials = CredentialsSchema.parse(Bun.env);
  const deadline = AbortSignal.timeout(90_000);
  const cancellation = Context.current().cancellationSignal;
  const result = await runMediaSafety(
    {
      sonarr: credentials.SONARR_API_KEY,
      radarr: credentials.RADARR_API_KEY,
      username: credentials.QBITTORRENT_USERNAME,
      password: credentials.QBITTORRENT_PASSWORD,
    },
    await mediaSafetyEnabled(),
    (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.any([
          deadline,
          cancellation,
          ...(init?.signal ? [init.signal] : []),
        ]),
      }),
  );
  for (const app of ["sonarr", "radarr"] as const)
    mediaSafetyRejected.inc({ application: app }, result.removed[app]);
  mediaSafetyLastSuccess.set(Date.now() / 1000);
  log.info("Media download safety scan", result);
  return result;
}

export const mediaSafetyActivities = { inspectMediaDownloadSafety };
export type MediaSafetyActivities = typeof mediaSafetyActivities;
