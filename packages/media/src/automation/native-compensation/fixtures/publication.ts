import type { MediaAutomationContext } from "#automation/context.ts";
import type { NativeCompensationObserverContext } from "#migration/native-compensation/evidence.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";

// The synthetic server's rating keys survive fresh Activity/client instances.
const serverKeys = new WeakMap<
  NativeCompensationObserverContext,
  Map<string, string>
>();
let nextServerKey = 9000;

/** Actual PlexClient parsing over the fixture's synthetic server data; no successful publication DTO is manufactured. */
export function compensationPublicationContext(
  base: MediaAutomationContext,
  source: NativeCompensationObserverContext,
  options: {
    requests: string[];
    beforeRefresh?: () => Promise<void>;
    beforeIdentity?: () => Promise<void>;
  },
): MediaAutomationContext {
  let keys = serverKeys.get(source);
  if (keys === undefined) {
    keys = new Map<string, string>();
    serverKeys.set(source, keys);
  }
  const stableKeys = keys;
  const seasons = new Map<string, PlexItem>();
  const key = (original: string) => {
    let value = stableKeys.get(original);
    if (value === undefined) {
      value = String(nextServerKey++);
      stableKeys.set(original, value);
    }
    return value;
  };
  const translate = (item: PlexItem): PlexItem => {
    let parent = item.parentRatingKey;
    if (parent === undefined && item.type === "episode") {
      if (
        item.grandparentRatingKey === undefined ||
        item.parentIndex === undefined
      )
        throw new Error(
          "Synthetic TV server requires the original show and season coordinate",
        );
      parent = `synthetic-season:${item.grandparentRatingKey}:${String(item.parentIndex)}`;
      // Explicit injected server hierarchy, not a production inference or a successful proof DTO.
      seasons.set(parent, {
        ratingKey: parent,
        type: "season",
        title: `Season ${String(item.parentIndex)}`,
        index: item.parentIndex,
        parentRatingKey: item.grandparentRatingKey,
      });
    }
    return {
      ...item,
      ratingKey: key(item.ratingKey),
      ...(parent === undefined ? {} : { parentRatingKey: key(parent) }),
      ...(item.grandparentRatingKey === undefined
        ? {}
        : { grandparentRatingKey: key(item.grandparentRatingKey) }),
      ...(item.Media === undefined
        ? {}
        : {
            Media: item.Media.map((media) => ({
              ...media,
              Part: media.Part.map((part) => ({
                ...part,
                id: Number(key(`synthetic-part:${part.file}`)),
              })),
            })),
          }),
    };
  };
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "compensation-fixture",
    },
    async (url) => {
      options.requests.push(url.pathname);
      if (url.pathname === "/identity") {
        await options.beforeIdentity?.();
        return Response.json({
          MediaContainer: { machineIdentifier: source.expectedServerMachineId },
        });
      }
      if (url.pathname === "/library/sections") {
        const sections = await source.plex.sections();
        return Response.json({
          MediaContainer: { size: sections.length, Directory: sections },
        });
      }
      if (url.pathname.endsWith("/refresh")) {
        await options.beforeRefresh?.();
        return new Response();
      }
      const sectionId = /^\/library\/sections\/(\d+)\/all$/u.exec(
        url.pathname,
      )?.[1];
      if (sectionId !== undefined) {
        const page = await source.plex.libraryPage({
          sectionId,
          kind: url.searchParams.get("type") === "1" ? "movie" : "episode",
          offset: Number(url.searchParams.get("X-Plex-Container-Start") ?? "0"),
        });
        return Response.json({
          MediaContainer: {
            size: page.items.length,
            totalSize: page.total,
            Metadata: page.items.map((item) => translate(item)),
          },
        });
      }
      const ratingKey = /^\/library\/metadata\/(\d+)$/u.exec(url.pathname)?.[1];
      if (ratingKey !== undefined) {
        const original = [...stableKeys].find(
          ([, value]) => value === ratingKey,
        )?.[0];
        if (original === undefined)
          throw new Error("Unexpected scoped Plex metadata key");
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [
              translate(
                seasons.get(original) ?? (await source.plex.metadata(original)),
              ),
            ],
          },
        });
      }
      throw new Error(
        `Unexpected compensation publication HTTP path: ${url.pathname}`,
      );
    },
  );
  return {
    ...base,
    serverMachineId: source.expectedServerMachineId,
    plex,
    plexAccess: async (sectionType) => {
      const sections = await source.permittedSections();
      return {
        serverMachineId: source.expectedServerMachineId,
        sectionType,
        sectionId: sectionType === "movie" ? sections.movie : sections.series,
      };
    },
  };
}
