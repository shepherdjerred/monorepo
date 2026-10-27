import type { PlexClient } from "#integrations/plex.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import type { PlexServingExpected } from "#shared/plex-binding/library.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";

export type AssociationExecution = {
  readonly signal: AbortSignal;
  assertActive: () => void;
  checkpoint: () => Promise<void>;
};

export type ServingVerificationInput = {
  purpose: "current_serving";
  expected: PlexServingExpected;
  canonicalTargets: readonly PlexCanonicalTarget[];
  access: readonly PlexAccess[];
  /** Captured by the invocation before config/canonical reads, never renewed here. */
  observed: { wall: number; monotonic: number };
  expiresAtMs: number;
  guards: readonly { assertActive: () => void }[];
};

export type AssociationContext = {
  plex: PlexClient;
  execution: AssociationExecution;
  freshness: PlexBindingFreshness;
};

export type VideoSection = {
  sectionId: string;
  sectionType: "movie" | "show";
};
