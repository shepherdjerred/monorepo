import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { ProviderRegistry } from "./providers.ts";
import type { WorkflowStarter } from "./store.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import type { WatchExecution } from "./plex-events/execution.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/authority.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";
import type {
  ReceiptQuery,
  ReceiptObservation,
} from "#integrations/notifications/receipts.ts";

export type MediaAutomationContext = {
  db: Database;
  watchExecution: () => WatchExecution;
  plexAccess: (sectionType: "movie" | "show") => Promise<PlexAccess>;
  plexBindingExecution: () => PlexBindingExecution;
  movieManagement?: MovieManagementInvocation;
  libraryManagement?: LibraryManagementInvocation;
  serverMachineId?: string;
  tmdb: TmdbClient;
  cipher: CredentialCipher;
  providers: ProviderRegistry;
  qbittorrent: QbittorrentClient;
  plex: PlexClient;
  userPlex: (serverToken: string) => PlexClient;
  startWorkflow: WorkflowStarter;
  describeWorkflow: (workflowId: string) => Promise<{
    status:
      | "RUNNING"
      | "COMPLETED"
      | "FAILED"
      | "CANCELLED"
      | "TERMINATED"
      | "CONTINUED_AS_NEW"
      | "TIMED_OUT"
      | "PAUSED"
      | "UNKNOWN"
      | "UNSPECIFIED";
    runId: string;
  } | null>;
  permittedSections: () => Promise<{ movie: string; series: string }>;
  refreshExclusionProofs: () => Promise<void>;
  refreshWriterLease: () => Promise<void>;
  gates: {
    acquisition: () => Promise<boolean>;
    sourceCleanup: () => Promise<boolean>;
    quarantine: () => Promise<boolean>;
    purge: () => Promise<boolean>;
  };
  publicOrigin: string;
  downloadRoot: string;
  notify: (
    message: {
      channel: "email" | "discord" | "discord_shared";
      recipient: string;
      subject: string;
      text: string;
      idempotencyKey: string;
    },
    mutation?: { beforeMutation: () => void },
  ) => Promise<{ receipt: string }>;
  reconcileNotification?: (input: ReceiptQuery) => Promise<ReceiptObservation>;
  personalDiscordAvailable?: () => Promise<boolean>;
  sharedAnnouncements?: () => Promise<{
    enabled: boolean;
    upgrades: boolean;
    channelId: string;
    available: boolean;
  }>;
};
