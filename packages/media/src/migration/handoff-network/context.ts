import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { PlexAuthentication } from "#application/auth.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { createLegacyObserver } from "#integrations/legacy-observer/runtime.ts";
import { MediaError } from "#application/errors.ts";

export type HandoffNetworkContext = {
  db: Database;
  cipher: CredentialCipher;
  plex: Pick<
    PlexClient,
    "machineIdentifier" | "sections" | "libraryPage" | "metadata"
  >;
  qbittorrent: Pick<QbittorrentClient, "listAll">;
  observer: ReturnType<typeof createLegacyObserver>;
  authentication: Pick<PlexAuthentication, "resolveServerAccess">;
  permittedSections: () => Promise<{ movie: string; series: string }>;
  expectedServerMachineId: string;
  canonicalRoots?: { movies: string; tv: string };
};
export const protectedEvidence = (code: string) =>
  new MediaError(
    code,
    "Trusted handoff evidence is unavailable or changed; review a fresh observation",
    409,
  );
