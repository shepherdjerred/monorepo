import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CredentialCipher } from "#application/security.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createMediaNetworkActivities } from "#automation/network.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import type { FileContext } from "#automation/files/types.ts";
import { capturePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { PlexClient } from "#integrations/plex.ts";
import { createSystemHttpServer } from "#testing/system/http.ts";
import { systemExternalServices } from "#testing/system/external.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { startLocalQbittorrent } from "./qbittorrent.ts";
import {
  connectLocalPeer,
  generateSyntheticMovie,
  seedSyntheticMovie,
  SYSTEM_RELEASE,
} from "./media.ts";
import { syntheticPlexWire } from "./plex.ts";
import { requestSystemMovie } from "./request.ts";
import { mountSystemUi } from "./ui.ts";
import { createMediaWorkflowStarter as workflowStarter } from "#automation/temporal-client.ts";
export function createMediaWorkflowStarter(
  input: Parameters<typeof workflowStarter>[0],
) {
  if (input.namespace !== "dev" || !/^127\.0\.0\.1:\d+$/.test(input.address))
    throw new Error(
      "System acceptance requires an isolated local dev Temporal server",
    );
  return workflowStarter(input);
}

/** Local system assembly, with production application and Activity factories.
 * Only identity/catalog/provider/PMS responses and ownership attestations are
 * synthetic. PG, Temporal, qBittorrent, media tools, bytes and journals are real.
 */
export async function createMediaSystemSandbox(
  ports: Pick<
    MediaAutomationContext,
    | "startWorkflow"
    | "describeWorkflow"
    | "watchExecution"
    | "plexBindingExecution"
  > & {
    compensationExecution: () => NativeCompensationExecutionContext;
    checkpoint: (phase: string) => Promise<void>;
    ui?: boolean;
  },
) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-system-flow-")),
  );
  const tasks: (() => Promise<void>)[] = [];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const results = await Promise.allSettled(
        tasks.toReversed().map((task) => task()),
      );
      const errors: unknown[] = [];
      for (const result of results)
        if (result.status === "rejected") errors.push(result.reason);
      if (errors.length > 0)
        throw new AggregateError(errors, "System sandbox teardown failed");
    })());
  try {
    const cluster = await startMediaTestPostgres();
    tasks.push(() => cluster.close());
    const db = cluster.database;
    const generated = path.join(root, "generated");
    await mkdir(generated);
    const movie = await generateSyntheticMovie(generated);
    const peers = await startLocalQbittorrent(root, [movie.sourcePath]);
    tasks.push(() => peers.close());
    const fixture = await seedSyntheticMovie(peers, movie);
    const plexWire = syntheticPlexWire(db, "isolated-system-server");
    const external = systemExternalServices((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v2/search")
        return Response.json({
          hits: [
            {
              id: "system-movie",
              title: SYSTEM_RELEASE,
              bytes: fixture.size,
              hash: fixture.infoHash,
              seeders: 1,
              details: new URL("/details", url).toString(),
              magnetUrl: null,
            },
          ],
        });
      return plexWire(request);
    });
    tasks.push(() => external.close());
    const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
    const http = createSystemHttpServer({
      ...external,
      db,
      cipher,
      plexTransport: external.transport,
      startWorkflow: ports.startWorkflow,
      describeWorkflow: ports.describeWorkflow,
    });
    tasks.push(() => http.close());
    if (ports.ui === true) {
      await mountSystemUi(http.app);
      const page = await fetch(http.origin);
      if (
        page.status !== 200 ||
        page.headers.get("content-type")?.startsWith("text/html") !== true
      )
        throw new Error("Mounted system UI did not serve its built HTML");
    }
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
    await db.mediaProvider.create({
      data: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    });
    const plexConfig = {
      baseUrl: external.plexUrl,
      token: "synthetic-owner",
      clientIdentifier: "system-acceptance",
    };
    const provider = new KnabenProvider(external.transport);
    const context: MediaAutomationContext = {
      db,
      cipher,
      tmdb: external.tmdb,
      serverMachineId: external.serverMachineId,
      watchExecution: ports.watchExecution,
      plexBindingExecution: ports.plexBindingExecution,
      plexAccess: (sectionType) =>
        Promise.resolve({
          serverMachineId: external.serverMachineId,
          sectionType,
          sectionId: sectionType === "movie" ? "1" : "2",
        }),
      providers: {
        withProvider: (id, work) => {
          if (id !== "knaben") throw new Error("Unexpected system provider");
          return work(provider);
        },
      },
      plex: new PlexClient(plexConfig),
      userPlex: (token) => new PlexClient({ ...plexConfig, token }),
      qbittorrent: peers.download.client,
      startWorkflow: ports.startWorkflow,
      describeWorkflow: ports.describeWorkflow,
      permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
      refreshExclusionProofs: () =>
        Promise.reject(
          new Error(
            "No exclusion proof is used by outside-library test control roots",
          ),
        ),
      refreshWriterLease: () => grantTestLease(db),
      gates: {
        acquisition: () => Promise.resolve(true),
        sourceCleanup: () => Promise.resolve(true),
        quarantine: () => Promise.resolve(true),
        purge: () => Promise.resolve(true),
      },
      publicOrigin: http.origin,
      downloadRoot: "/downloads",
      notify: () =>
        Promise.reject(
          new Error(
            "Notification sink not connected in the movie acquisition scenario",
          ),
        ),
    };
    const canonical = {
      movies: {
        downloads: "/downloads",
        library: "/data/movies",
        control: "/control/movies",
      },
      tv: {
        downloads: "/downloads",
        library: "/data/tv",
        control: "/control/tv",
      },
    };
    const roots = {
      movies: {
        downloads: peers.downloadRoot,
        library: path.join(root, "library", "movies"),
        control: path.join(root, "control", "movies"),
      },
      tv: {
        downloads: peers.downloadRoot,
        library: path.join(root, "library", "tv"),
        control: path.join(root, "control", "tv"),
      },
    };
    for (const entry of Object.values(roots)) {
      await mkdir(entry.library, { recursive: true });
      await mkdir(entry.control, { recursive: true });
    }
    const mapping = createMediaPathMapping({
      canonicalRoots: canonical,
      workerRoots: roots,
    });
    const files: FileContext = {
      db,
      roots,
      pathMapping: mapping,
      serverMachineId: external.serverMachineId,
      permittedMovieSection: () => Promise.resolve("1"),
      plexAccess: context.plexAccess,
      checkpoint: ports.checkpoint,
      publicationExecution: () =>
        capturePublicationExecution(ports.compensationExecution, "publication"),
      enabled: context.gates,
      verifyStorageAuthority: (target) =>
        requireStorageAuthority(
          db,
          target.library === roots.movies.library
            ? canonical.movies.library
            : canonical.tv.library,
          "system-files-worker",
        ),
    };
    const refreshAuthority = async () => {
      await grantTestLease(db);
      for (const kind of ["movies", "tv"] as const) {
        const observedAt = new Date();
        const data = {
          recoveryEpoch: 0,
          pvcUid: `synthetic-${kind}`,
          volumeName: `synthetic-${kind}`,
          volumePath: canonical[kind].library,
          workerPodUid: "system-files-worker",
          evidence: { fixture: true, source: "isolated-system-acceptance" },
          observedAt,
          expiresAt: new Date(observedAt.getTime() + 120_000),
          revokedAt: null,
        };
        await db.mediaStorageAuthority.upsert({
          where: { rootPath: canonical[kind].library },
          create: { rootPath: canonical[kind].library, ...data },
          update: data,
        });
      }
    };
    await refreshAuthority();
    const network = createMediaNetworkActivities(context, {
      ...createRetentionActivities(context),
      ...createSubtitleActivities(context),
      ...createNotificationActivities(context),
    });
    return {
      root,
      db,
      http,
      fixture,
      peers,
      mapping,
      refreshAuthority,
      close,
      request: () => requestSystemMovie(http.origin),
      connectPeer: () => connectLocalPeer(peers, fixture.infoHash),
      facets: createPlexRuntimeFacets(context, () => Promise.resolve(false)),
      network,
      files: createMediaFileActivities(files),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
