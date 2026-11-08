import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { createPlexExclusionNetworkActivities } from "./network.ts";
import { createPlexExclusionFileActivities } from "./files.ts";

const Common = z.object({ DATABASE_URL: z.string().min(1) });
const Network = Common.extend({
  PLEX_SERVER_URL: z.url(),
  PLEX_SERVER_TOKEN: z.string().min(1),
  PLEX_SERVER_MACHINE_ID: z.string().min(1),
  ENVIRONMENT: z
    .enum(["production", "staging", "development", "test"])
    .default("production"),
});
const Files = Common.extend({
  MEDIA_MOVIES_LIBRARY_ROOT: z.string().startsWith("/"),
  MEDIA_TV_LIBRARY_ROOT: z.string().startsWith("/"),
});

export async function createPlexExclusionNetworkRuntime(
  environment: Record<string, string | undefined>,
  checkpoint: () => Promise<void>,
) {
  const config = Network.parse(environment);
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const behavior = mediaBehaviorConfig(config.ENVIRONMENT, true);
  const activities = createPlexExclusionNetworkActivities({
    db,
    machineId: config.PLEX_SERVER_MACHINE_ID,
    checkpoint,
    plex: new PlexMaintenanceClient({
      baseUrl: config.PLEX_SERVER_URL,
      token: config.PLEX_SERVER_TOKEN,
      clientIdentifier: `media-${config.PLEX_SERVER_MACHINE_ID}`,
    }),
    async permittedSections() {
      const [movie, series] = await Promise.all([
        behavior.get("permittedMovieSectionId"),
        behavior.get("permittedTvSectionId"),
      ]);
      return { movie: movie.value, series: series.value };
    },
  });
  return { activities, close: () => db.$disconnect() };
}
export async function createPlexExclusionFileRuntime(
  environment: Record<string, string | undefined>,
  checkpoint: () => Promise<void>,
) {
  const config = Files.parse(environment);
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  return {
    activities: createPlexExclusionFileActivities({
      db,
      roots: {
        movies: config.MEDIA_MOVIES_LIBRARY_ROOT,
        tv: config.MEDIA_TV_LIBRARY_ROOT,
      },
      checkpoint,
    }),
    close: () => db.$disconnect(),
  };
}
