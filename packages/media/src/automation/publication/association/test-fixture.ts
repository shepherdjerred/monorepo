import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { PlexCanonicalTargetSchema } from "#shared/plex-binding/canonical.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type {
  AssociationExecution,
  ServingVerificationInput,
} from "./types.ts";

/** Synthetic HTTP/canonical inputs only; DB loader acceptance is a separate suite. */
export function associationFixture(
  kind: "movie" | "episode" = "movie",
  count = 1,
) {
  const rootId = crypto.randomUUID();
  const scopes = Array.from({ length: count }, () => ({
    mediaId: kind === "movie" ? rootId : crypto.randomUUID(),
    edition: "default" as const,
  })).sort((a, b) => a.mediaId.localeCompare(b.mediaId));
  const canonicalIdentityHash = "a".repeat(64),
    numberingHash = "b".repeat(64);
  const canonicalTargets = scopes.map((scope, index) =>
    PlexCanonicalTargetSchema.parse({
      scope,
      kind,
      canonicalRootId: rootId,
      canonicalIdentityHash,
      numberingHash,
      references: [
        {
          kind: kind === "movie" ? "movie" : "series",
          namespace: "tmdb",
          value: "123",
        },
      ],
      ...(kind === "movie"
        ? {}
        : {
            coordinate: {
              mediaId: scope.mediaId,
              mediaVersion: 1,
              seriesId: rootId,
              seasonNumber: 1,
              episodeNumber: index + 1,
              tmdbEpisodeId: index + 1000,
              absoluteNumber: null,
              numberingProvenance: { kind: "canonical" },
            },
          }),
    }),
  );
  const group = {
    assetId: crypto.randomUUID(),
    assetVersion: 1,
    checksum: "d".repeat(64),
    sizeBytes: "128",
    canonicalPath: `/data/${kind === "movie" ? "movies" : "tv"}/Synthetic.mkv`,
    ownershipEpoch: 0,
    canonicalRootId: rootId,
    edition: "default" as const,
    coverage: scopes,
    coverageHash: snapshotHash(scopes),
  };
  const access = {
    serverMachineId: "synthetic-server",
    sectionId: "1",
    sectionType: kind === "movie" ? ("movie" as const) : ("show" as const),
  };
  const expected = PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: 0,
    access: [access],
    targets: scopes.map((scope) => ({
      scope,
      editionRootId: rootId,
      mediaVersion: 1,
      intentVersion: 1,
      generation: 1,
      automationEpoch: 0,
      canonicalIdentityHash,
      numberingHash,
      definition: {
        rootMediaId: rootId,
        key: "default",
        definitionVersion: 1,
        definitionHash: "c".repeat(64),
      },
    })),
    previous: scopes.map((scope) => ({ scope, revision: 0, evidence: null })),
    oldGroups: [],
    newGroups: [group],
    parents: [
      {
        kind: "existing_asset",
        assetId: group.assetId,
        assetVersion: 1,
        recoveryEpoch: 0,
        physicalGrant: null,
      },
    ],
  });
  const items: PlexItem[] = scopes.map((_scope, index) => ({
    ratingKey: String(index + 10),
    type: kind,
    title: "Synthetic",
    Guid: [{ id: `tmdb://${kind === "movie" ? "123" : String(index + 1000)}` }],
    Media: [{ Part: [{ id: 500, file: group.canonicalPath, size: 128 }] }],
    ...(kind === "movie"
      ? {}
      : {
          parentRatingKey: "900",
          grandparentRatingKey: "901",
          parentIndex: 1,
          index: index + 1,
        }),
  }));
  const metadata = new Map<string, PlexItem>([
    [
      "900",
      {
        ratingKey: "900",
        type: "season",
        title: "Season",
        index: 1,
        parentRatingKey: "901",
      },
    ],
    [
      "901",
      {
        ratingKey: "901",
        type: "show",
        title: "Series",
        Guid: [{ id: "tmdb://123" }],
      },
    ],
  ]);
  const sections = [{ key: "1", type: access.sectionType, title: "Synthetic" }];
  const calls: URL[] = [];
  const controller = new AbortController();
  const execution: AssociationExecution = {
    signal: controller.signal,
    assertActive: () => {
      controller.signal.throwIfAborted();
    },
    checkpoint: () => {
      controller.signal.throwIfAborted();
      return Promise.resolve();
    },
  };
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const input: ServingVerificationInput & { expected: typeof expected } = {
    purpose: "current_serving",
    expected,
    canonicalTargets,
    access: [access],
    observed,
    expiresAtMs: observed.wall + 60_000,
    guards: [],
  };
  const reply = (url: URL) => {
    if (url.pathname === "/identity") {
      return Response.json({
        MediaContainer: { machineIdentifier: access.serverMachineId },
      });
    }
    if (url.pathname === "/library/sections") {
      return Response.json({
        MediaContainer: { size: sections.length, Directory: sections },
      });
    }
    if (url.pathname === "/library/sections/1/all") {
      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
      const size = Number(url.searchParams.get("X-Plex-Container-Size"));
      return page(items.slice(offset, offset + size), items.length);
    }
    const key = url.pathname.split("/").at(-1);
    const item =
      key === undefined
        ? undefined
        : (metadata.get(key) ?? items.find((row) => row.ratingKey === key));
    if (item !== undefined && url.pathname.startsWith("/library/metadata/")) {
      return Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
    }
    throw new Error(`Unexpected synthetic Plex request: ${url.pathname}`);
  };
  const createClient = (
    intercept?: (url: URL, init: RequestInit) => Response | undefined,
  ) => {
    const transport: FetchTransport = (url, init) => {
      calls.push(url);
      return Promise.resolve(intercept?.(url, init) ?? reply(url));
    };
    return new PlexClient(
      {
        baseUrl: "http://plex.invalid",
        token: "synthetic",
        clientIdentifier: "fixture",
      },
      transport,
    );
  };
  return {
    input,
    execution,
    controller,
    calls,
    items,
    metadata,
    sections,
    createClient,
  };
}

export function page(items: PlexItem[], total = items.length) {
  return Response.json({
    MediaContainer: { size: items.length, totalSize: total, Metadata: items },
  });
}
