import type { z } from "zod";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { HistoryProviderSchema } from "./provider.ts";

export type RecordMedia = {
  readonly title: string;
  readonly provider: z.infer<typeof HistoryProviderSchema>;
  readonly source: Source;
  readonly canonicalUrl?: string | undefined;
  readonly channel?: string | undefined;
  readonly thumbnailUrl?: string | undefined;
  readonly durationSeconds?: number | undefined;
};

export type HistoryScope = {
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
};
