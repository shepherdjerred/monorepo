import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { ProviderRegistry } from "./providers.ts";
import type { WorkflowStarter } from "./store.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";

export type MediaAutomationContext = {
  db: Database;
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
  gates: {
    acquisition: () => Promise<boolean>;
    sourceCleanup: () => Promise<boolean>;
    quarantine: () => Promise<boolean>;
    purge: () => Promise<boolean>;
  };
  publicOrigin: string;
  downloadRoot: string;
  notify: (message: {
    channel: "email" | "discord";
    recipient: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<{ receipt: string }>;
};
