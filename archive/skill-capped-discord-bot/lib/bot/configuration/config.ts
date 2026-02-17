import Site from "../site";

export interface Config {
  awsRegion: string;
  s3BucketArn: string;
  discordToken: string;
  siteMapping: SiteMapping[];
}

export interface SiteMapping {
  site: Site;
  enabled: boolean;
  discordChannel: string;
  notificationSettings: NotificationSettings;
}

export interface NotificationSettings {
  sendCommentaries: boolean;
  sendVideos: boolean;
}
