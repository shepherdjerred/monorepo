import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "./notification/notification";
import { parse } from "./schema/parser";
import { RawSchemas } from "./schema/rawSchema";
import Site from "./site";
import { Storage } from "./storage/storage";
import { siteToString } from "./utilities";
import { filterNewVideos } from "./video/newVideoFinder";

export class Processor {
  private readonly previousManifestStorage: Storage<JSON>;
  private readonly currentManifestStorage: Storage<JSON>;
  private readonly notifier: Notifier;
  constructor(
    previousManifestStorage: Storage<JSON>,
    currentManifestStorage: Storage<JSON>,
    notifier: Notifier
  ) {
    this.previousManifestStorage = previousManifestStorage;
    this.currentManifestStorage = currentManifestStorage;
    this.notifier = notifier;
  }

  async process(site: Site) {
    const key = siteToString(site);
    const previousManifestRaw = await this.previousManifestStorage.get(key);
    const currentManifestRaw = await this.currentManifestStorage.get(key);
    const previousManifest = parse(
      site,
      previousManifestRaw as unknown as RawSchemas
    );
    const currentManifest = parse(
      site,
      currentManifestRaw as unknown as RawSchemas
    );
    const newVideos = filterNewVideos(
      currentManifest.videos,
      previousManifest.videos
    );
    const newCommentaries = filterNewVideos(
      currentManifest.commentaries,
      previousManifest.commentaries
    );
    const videoNotification: VideoNotification = {
      groups: [
        {
          identifier: "lump",
          content: newVideos,
        },
      ],
    };
    const commentaryNotificaiton: CommentaryNotification = {
      groups: [
        {
          identifier: "lump",
          content: newCommentaries,
        },
      ],
    };
    await this.notifier.notifyVideos(videoNotification);
    await this.notifier.notifyCommentaries(commentaryNotificaiton);
    await this.previousManifestStorage.set(key, previousManifestRaw);
  }
}
