import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import type { FetchTransport } from "#integrations/http.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";

/** Injected Plex wire only. Callers supply actual reviewed groups; this creates no database authority. */
export function nativePlexWireFixture(input: {
  access: readonly PlexAccess[];
  groups: readonly {
    canonicalPath: string;
    sizeBytes: string;
    targets: readonly PlexCanonicalTarget[];
  }[];
}) {
  const server = input.access[0]?.serverMachineId;
  if (
    server === undefined ||
    input.access.some((value) => value.serverMachineId !== server)
  )
    throw new Error("Synthetic Plex fixture requires one explicit server");
  let sequence = Number.parseInt(
    crypto.randomUUID().replaceAll("-", "").slice(0, 10),
    16,
  );
  const next = () => String(++sequence);
  const items: PlexItem[] = [];
  const metadata = new Map<string, PlexItem>();
  const shows = new Map<string, string>();
  const seasons = new Map<string, string>();
  const sessions: PlexItem[] = [];
  const calls: URL[] = [];
  for (const group of input.groups) {
    const size = fixturePartSize(group.sizeBytes);
    const partId = Number(next());
    for (const target of group.targets) {
      const access = input.access.find(
        (value) =>
          value.sectionType === (target.kind === "movie" ? "movie" : "show"),
      );
      if (access === undefined)
        throw new Error("Synthetic Plex target has no configured section");
      const section = fixtureSectionId(access.sectionId);
      const rootGuids = target.references.map((reference) => ({
        id: `${reference.namespace}://${reference.value}`,
      }));
      const ratingKey = next();
      const common = {
        ratingKey,
        title: "Synthetic native catalog",
        librarySectionID: section,
        Media: [{ Part: [{ id: partId, file: group.canonicalPath, size }] }],
      };
      if (target.kind === "movie") {
        items.push({ ...common, type: "movie", Guid: rootGuids });
        continue;
      }
      const showKey = `${access.sectionId}:${target.canonicalRootId}`;
      const seasonKey = `${showKey}:${String(target.coordinate.seasonNumber)}`;
      const showId = shows.get(showKey) ?? next();
      const seasonId = seasons.get(seasonKey) ?? next();
      shows.set(showKey, showId);
      seasons.set(seasonKey, seasonId);
      metadata.set(showId, {
        ratingKey: showId,
        type: "show",
        title: "Synthetic series",
        librarySectionID: section,
        Guid: rootGuids,
      });
      metadata.set(seasonId, {
        ratingKey: seasonId,
        type: "season",
        title: "Synthetic season",
        librarySectionID: section,
        parentRatingKey: showId,
        index: target.coordinate.seasonNumber,
      });
      items.push({
        ...common,
        type: "episode",
        parentRatingKey: seasonId,
        grandparentRatingKey: showId,
        parentIndex: target.coordinate.seasonNumber,
        index: target.coordinate.episodeNumber,
        Guid:
          target.coordinate.tmdbEpisodeId === null
            ? []
            : [{ id: `tmdb://${String(target.coordinate.tmdbEpisodeId)}` }],
      });
    }
  }
  const reply = (url: URL) => {
    if (url.pathname === "/identity")
      return Response.json({ MediaContainer: { machineIdentifier: server } });
    if (url.pathname === "/library/sections")
      return Response.json({
        MediaContainer: {
          size: input.access.length,
          Directory: input.access.map((value) => ({
            key: value.sectionId,
            type: value.sectionType,
            title: "Synthetic",
          })),
        },
      });
    if (url.pathname === "/status/sessions")
      return Response.json({
        MediaContainer: { size: sessions.length, Metadata: sessions },
      });
    const section = input.access.find(
      (value) => url.pathname === `/library/sections/${value.sectionId}/all`,
    );
    if (section !== undefined) {
      const selected = items.filter(
        (item) => String(item.librarySectionID) === section.sectionId,
      );
      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
      const size = Number(url.searchParams.get("X-Plex-Container-Size"));
      const page = selected.slice(offset, offset + size);
      return Response.json({
        MediaContainer: {
          size: page.length,
          totalSize: selected.length,
          offset,
          Metadata: page,
        },
      });
    }
    const key = url.pathname.split("/").at(-1);
    const item =
      key === undefined
        ? undefined
        : (metadata.get(key) ?? items.find((value) => value.ratingKey === key));
    if (item !== undefined && url.pathname.startsWith("/library/metadata/"))
      return Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
    throw new Error(`Unexpected injected native Plex request: ${url.pathname}`);
  };
  const create = (
    intercept?: (
      url: URL,
      init: RequestInit,
    ) => Response | undefined | Promise<Response | undefined>,
  ) => {
    const transport: FetchTransport = async (url, init) => {
      calls.push(url);
      return (await intercept?.(url, init)) ?? reply(url);
    };
    return new PlexClient(
      {
        baseUrl: "http://plex.invalid",
        token: "synthetic",
        clientIdentifier: "native-fixture",
      },
      transport,
    );
  };
  return { plex: create(), create, items, metadata, sessions, calls };
}

function fixturePartSize(sizeBytes: string) {
  const size = Number(sizeBytes);
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error("Synthetic Plex Part size is not representable");
  return size;
}

function fixtureSectionId(sectionId: string) {
  const section = Number(sectionId);
  if (!Number.isSafeInteger(section) || section < 1)
    throw new Error("Synthetic Plex section is not representable");
  return section;
}
