import { Config, SiteMapping } from "./config";

export function loadConfigFromEnvironment(): Config {
  return {
    discordToken: process.env.discordToken as string,
    siteMapping: JSON.parse(process.env.siteMapping as string) as SiteMapping[],
    awsRegion: process.env.awsRegion as string,
    s3BucketArn: process.env.s3BucketArg as string,
  };
}
