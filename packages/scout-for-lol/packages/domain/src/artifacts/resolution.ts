import type { GameResult } from "./game-result.ts";

/** Evidence provenance is audit data; consumers decide from coverage and availability. */
export type EvidenceReference = {
  readonly source: GameResult["source"];
  readonly sourceId: string;
};

export type ArtifactResolution<T> =
  | {
      readonly kind: "available";
      readonly value: T;
      readonly evidence: readonly EvidenceReference[];
      readonly coverage: "complete" | "partial";
      readonly frozen: boolean;
    }
  | { readonly kind: "pending"; readonly retryAt: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "conflict";
      readonly evidence: readonly EvidenceReference[];
    };
