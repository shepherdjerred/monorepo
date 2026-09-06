import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

export type MediaProvider = "history" | "local" | "youtube";

export type MediaCandidate = {
  readonly token: string;
  readonly provider: MediaProvider;
  readonly title: string;
  readonly source: Source;
  readonly score: number;
  readonly channel?: string;
  readonly canonicalUrl?: string;
  readonly thumbnailUrl?: string;
  readonly durationSeconds?: number;
  readonly reason: string;
};

export type DiscoveryScope = {
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
};

export type DiscoveryResult =
  | { readonly kind: "found"; readonly candidate: MediaCandidate }
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly MediaCandidate[];
    }
  | { readonly kind: "not-found" };
