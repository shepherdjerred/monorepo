import { S3Storage } from "./storage/s3Storage";
import { JsonSerializer } from "./serialization/jsonSerializer";
import { Processor } from "./processor";
import { LiveManifestFetcher } from "./manifest/liveManifestFetcher";
import { SiteFetcherStorage } from "./storage/siteFetcherStorage";
import { loadConfigFromEnvironment } from "./configuration/environmentVariableConfigLoader";
import { DiscordNotifier } from "./notification/discord/discordNotifier";
import { FilteringNotifier } from "./notification/filter/FilteringNotifier";

export interface Event {
  bucketArn: string;
}

export const handler = async (
  _event: Event,
  _context: unknown
): Promise<undefined> => {
  const configuration = loadConfigFromEnvironment();
  const serializer = new JsonSerializer<JSON>();
  const previousStorage = new S3Storage<JSON>(
    configuration.awsRegion,
    configuration.s3BucketArn,
    serializer
  );
  const currentFetcher = new LiveManifestFetcher();
  const currentStorage = new SiteFetcherStorage(currentFetcher, false);
  await Promise.all(
    configuration.siteMapping.map((mapping) => {
      const discordNotifier = new DiscordNotifier(
        configuration.discordToken,
        mapping.discordChannel
      );
      const notifier = new FilteringNotifier(
        mapping.notificationSettings,
        discordNotifier
      );
      const processor = new Processor(
        previousStorage,
        currentStorage,
        notifier
      );
      return processor.process(mapping.site);
    })
  );
  return Promise.resolve(undefined);
};
