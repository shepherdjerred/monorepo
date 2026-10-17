import type { MediaAutomationContext } from "#automation/context.ts";
import type { NativeCompensationObserverContext } from "#migration/native-compensation/evidence.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";

// The synthetic server's rating keys survive fresh Activity/client instances.
const serverKeys = new WeakMap<
  NativeCompensationObserverContext,
  Map<string, string>
>();

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
  const translate = (item: PlexItem): PlexItem => {
    const key = (original: string) => {
      let value = stableKeys.get(original);
      if (value === undefined) {
        value = String(9000 + stableKeys.size);
        stableKeys.set(original, value);
      }
      return value;
    };
    return {
      ...item,
      ratingKey: key(item.ratingKey),
      ...(item.grandparentRatingKey === undefined
        ? {}
        : { grandparentRatingKey: key(item.grandparentRatingKey) }),
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
            Metadata: [translate(await source.plex.metadata(original))],
          },
        });
      }
      throw new Error(
        `Unexpected compensation publication HTTP path: ${url.pathname}`,
      );
    },
  );
  return { ...base, serverMachineId: source.expectedServerMachineId, plex };
}
