import type {
  MovieOperationV4,
  MovieAttemptOperationV4,
  MovieDecisionOperationV4,
} from "./automation-v4.ts";
import type {
  MovieSubtitleOperationV4,
  MovieSubtitleInstallV4,
} from "./subtitles-v4.ts";
import type {
  ObserveMoviePlexHintV4,
  ObservePlexHintResult,
} from "#shared/plex-events/contract.ts";
import type { MovieRetentionResultV4 } from "./retention-v4.ts";
import type { MovieRemovalCompletionV4 } from "./removal-v4.ts";

export type MovieWatchActivitiesV4 = {
  observeMoviePlexHintV4: (
    input: ObserveMoviePlexHintV4,
  ) => Promise<ObservePlexHintResult>;
};

/** Scoped IDs only; private releases, file plans and credentials stay in Activities. */
export type MovieNetworkActivitiesV4 = {
  completeMovieRemovalV4: (input: MovieRemovalCompletionV4) => Promise<{
    status: "completed" | "obsolete";
    reason: string | null;
  }>;
  finalizeMovieRestorationV4: (input: MovieOperationV4) => Promise<void>;
  publishRestoredMovieToPlexV4: (input: MovieOperationV4) => Promise<{
    status: "available" | "waiting" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  evaluateMovieRetentionV4: (
    input: MovieOperationV4,
  ) => Promise<MovieRetentionResultV4>;
  findMovieSubtitlesV4: (input: MovieSubtitleOperationV4) => Promise<{
    status: "found" | "waiting" | "blocked" | "obsolete";
    subtitleId: string | null;
    reason: string | null;
  }>;
  reconcileMovieIntentV4: (input: MovieOperationV4) => Promise<{
    status: "acquire" | "available" | "waiting" | "blocked" | "obsolete";
    attemptId: string | null;
    reason: string | null;
  }>;
  submitMovieTorrentV4: (input: MovieAttemptOperationV4) => Promise<{
    status: "submitted" | "waiting" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  observeMovieAcquisitionV4: (input: MovieAttemptOperationV4) => Promise<{
    status: "ready" | "downloading" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  publishMovieToPlexV4: (input: MovieAttemptOperationV4) => Promise<{
    status: "available" | "waiting" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  finalizeMovieAcquisitionV4: (input: MovieAttemptOperationV4) => Promise<void>;
};
export type MovieFileActivitiesV4 = {
  restoreMovieFilesV4: (input: MovieOperationV4) => Promise<{
    status: "restored" | "protected";
    reason?: string;
  }>;
  purgeMovieFilesV4: (input: MovieDecisionOperationV4) => Promise<{
    status: "purged" | "protected";
    reason?: string;
  }>;
  quarantineMovieFilesV4: (input: MovieDecisionOperationV4) => Promise<{
    status: "quarantined" | "protected";
    reason?: string;
  }>;
  installMovieSubtitlesV4: (input: MovieSubtitleInstallV4) => Promise<{
    status: "installed" | "blocked";
    reason?: string;
  }>;
  inspectAndStageMovieV4: (input: MovieAttemptOperationV4) => Promise<{
    status: "staged" | "blocked";
    reason?: string;
  }>;
  promoteMovieFilesV4: (input: MovieAttemptOperationV4) => Promise<{
    status: "published" | "blocked";
    reason?: string;
  }>;
};
