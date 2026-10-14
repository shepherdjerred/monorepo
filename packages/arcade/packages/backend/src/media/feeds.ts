import type { Server, IncomingMessage } from "node:http";
import {
  DriverFeedService,
  type DriverFeedAdmission,
} from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import { DRIVER_FEED_PATH } from "@shepherdjerred/discord-plays-core/driver-feed/protocol.ts";
import type { DriverFeedConfig } from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";

export type MediaFormat = {
  width: number;
  height: number;
  fps: number;
  pixelFormat: "rgba" | "bgra";
  audioSampleRate: number;
  audioChannels: number;
  displayAspect: number;
};

export class MediaFeeds {
  readonly upgradePaths: string[] = [];

  constructor(
    private readonly options: {
      server: Server;
      logger: Logger;
      admit: (
        sessionId: string,
        request: IncomingMessage,
      ) => Promise<DriverFeedAdmission>;
    },
  ) {}

  create(
    sessionId: string,
    format: MediaFormat,
    settings: {
      driver_feed: DriverFeedConfig;
      stream: {
        video: {
          hardware_acceleration: boolean;
          vaapi_device: string;
          encoder_async_depth?: number;
        };
      };
    },
  ): { service: DriverFeedService; close: () => void } {
    const path = `${DRIVER_FEED_PATH}/${sessionId}`;
    if (this.upgradePaths.includes(path))
      throw new Error("session feed is already attached");
    const service = new DriverFeedService({
      config: settings.driver_feed,
      video: {
        ...settings.stream.video,
        encoder_async_depth: settings.stream.video.encoder_async_depth ?? 1,
      },
      source: format,
      audio: {
        sampleRate: format.audioSampleRate,
        channels: format.audioChannels,
      },
      displayAspect: format.displayAspect,
      logger: this.options.logger,
      path,
    });
    service.setAdmission((request) => this.options.admit(sessionId, request));
    this.upgradePaths.push(path);
    const detach = service.attach(this.options.server);
    return {
      service,
      close: () => {
        detach();
        const index = this.upgradePaths.indexOf(path);
        if (index !== -1) this.upgradePaths.splice(index, 1);
      },
    };
  }
}
