import path from "node:path";
import type { Config } from "@discord-plays-mario-kart/backend/config/schema.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";
import type { MediaFeeds } from "#src/media/feeds.ts";
import type { StatsStore } from "#src/stats/store.ts";
import type { GameId } from "@arcade/common/catalog.ts";
import { browserRuntimeHost } from "#src/runtime/browser-host.ts";
import { DolphinHost } from "#src/runtime/dolphin-host.ts";
import { MkwTelemetry } from "./mkwii/telemetry.ts";
import { MeleeTelemetry } from "./melee/telemetry.ts";
import { BrawlTelemetry, BrawlMemorySchema } from "./brawl/telemetry.ts";
import { nativeModule } from "./native.ts";
import { nativeFormats } from "./formats.ts";

export function newerModules(options: {
  config: Config;
  assets: string;
  chromium: string;
  dolphin: string;
  port: number;
  startupTimeoutMs: number;
  feeds: MediaFeeds;
  stats: StatsStore;
  statsChanged: (guildId: string, gameId: GameId) => void;
  logger: Logger;
}) {
  const browserScript = path.resolve(
    import.meta.dirname,
    "../../../common/dist/browser/browser.js",
  );
  const wii = nativeModule({
    ...options,
    gameId: "mkwii",
    decode: () => {
      const codec = new MkwTelemetry();
      return (data) => codec.observe(data);
    },
    host: (sessionDir, callbacks) =>
      browserRuntimeHost({
        config: {
          gameId: "mkwii",
          sourceRevision: "b19270fb9c1590673528a52d34ce4afb780cbee5",
          discSize: null,
          format: nativeFormats.mkwii,
        },
        assets: options.assets,
        sessionDir,
        executable: options.chromium,
        port: options.port,
        startupTimeoutMs: options.startupTimeoutMs,
        browserScript,
        callbacks,
      }),
  });
  const melee = nativeModule({
    ...options,
    gameId: "melee",
    decode: () => {
      const codec = new MeleeTelemetry();
      return (data) => codec.observe(data);
    },
    host: (sessionDir, callbacks) =>
      browserRuntimeHost({
        config: {
          gameId: "melee",
          sourceRevision: "5bc531aafcc941866f2c916afebc38ee75543222",
          discSize: null,
          format: nativeFormats.melee,
        },
        assets: options.assets,
        sessionDir,
        executable: options.chromium,
        port: options.port,
        startupTimeoutMs: options.startupTimeoutMs,
        browserScript,
        callbacks,
      }),
  });
  const brawl = nativeModule({
    ...options,
    gameId: "brawl",
    decode: () => {
      const codec = new BrawlTelemetry();
      return (data) => codec.update(BrawlMemorySchema.parse(data));
    },
    host: (sessionDir, callbacks) =>
      new DolphinHost({
        assets: options.assets,
        sessionDir,
        executable: options.dolphin,
        startupTimeoutMs: options.startupTimeoutMs,
        format: nativeFormats.brawl,
        callbacks,
        logger: options.logger,
      }),
  });
  return [wii, melee, brawl];
}
