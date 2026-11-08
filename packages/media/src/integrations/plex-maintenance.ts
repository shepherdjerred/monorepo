import { z } from "zod";
import { createHash } from "node:crypto";
import { PlexClient, type PlexItem } from "./plex.ts";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import {
  PlexSectionSnapshotSchema,
  type PlexPartInventory,
  type PlexSectionSnapshot,
} from "#shared/plex-exclusion.ts";

const SectionSchema = z.object({
  key: z.string().regex(/^\d+$/u),
  uuid: z.string().min(1),
  type: z.enum(["movie", "show", "artist", "photo"]),
  scanner: z.string().min(1),
  agent: z.string().min(1),
  scannedAt: z.number().int().nonnegative(),
  refreshing: z.boolean(),
  Location: z
    .array(z.object({ id: z.number().int(), path: z.string().startsWith("/") }))
    .min(1),
});

/** Scanner evidence uses /library/sections; /library/sections/:id is a filter menu. */
export class PlexMaintenanceClient {
  private readonly library: PlexClient;
  constructor(
    private readonly config: {
      baseUrl: string;
      token: string;
      clientIdentifier: string;
    },
    private readonly transport: FetchTransport = fetch,
  ) {
    endpoint(config.baseUrl, "/");
    this.library = new PlexClient(config, transport);
  }
  async topology(
    sectionId: string,
    signal?: AbortSignal,
  ): Promise<PlexSectionSnapshot> {
    z.string().regex(/^\d+$/u).parse(sectionId);
    const identity = z
      .object({
        MediaContainer: z.object({
          machineIdentifier: z.string().min(1),
          version: z.string().min(1),
        }),
      })
      .parse(await this.get("identity", signal)).MediaContainer;
    const container = z
      .object({
        MediaContainer: z.object({
          size: z.number().int().nonnegative(),
          Directory: z.array(SectionSchema).optional(),
        }),
      })
      .parse(await this.get("library/sections", signal)).MediaContainer;
    const sections = container.Directory ?? [];
    const matches = sections.filter((section) => section.key === sectionId);
    const section = matches[0];
    if (
      section === undefined ||
      container.size !== sections.length ||
      matches.length !== 1 ||
      (section.type !== "movie" && section.type !== "show")
    )
      throw new IntegrationError("plex", "invalid-response");
    return PlexSectionSnapshotSchema.parse({
      serverMachineId: identity.machineIdentifier,
      serverVersion: identity.version,
      sectionId,
      sectionUuid: section.uuid,
      kind: section.type === "movie" ? "movie" : "episode",
      scanner: section.scanner,
      agent: section.agent,
      locations: section.Location.map((location) => location.path).sort(),
      scannedAt: section.scannedAt,
      refreshing: section.refreshing,
    });
  }
  async activities(signal?: AbortSignal): Promise<string[]> {
    const value = z
      .object({
        MediaContainer: z.object({
          size: z.number().int().nonnegative(),
          Activity: z
            .array(z.object({ uuid: z.string().min(1) }))
            .max(10_000)
            .optional(),
        }),
      })
      .parse(await this.get("activities", signal)).MediaContainer;
    if (value.size !== (value.Activity?.length ?? 0))
      throw new IntegrationError("plex", "invalid-response");
    return (value.Activity ?? []).map((activity) => activity.uuid);
  }
  /** Caller persists a sending journal before this mutation. A lost reply must be reconciled. */
  async scanRoot(
    section: PlexSectionSnapshot,
    libraryRoot: string,
    signal?: AbortSignal,
  ): Promise<{ activityId: string | null }> {
    PlexSectionSnapshotSchema.parse(section);
    if (!section.locations.includes(libraryRoot))
      throw new IntegrationError("plex", "conflict");
    const url = endpoint(
      this.config.baseUrl,
      `library/sections/${section.sectionId}/refresh`,
    );
    url.searchParams.set("path", libraryRoot);
    const response = await request(this.transport, "plex", url, {
      method: "POST",
      mutation: true,
      headers: this.headers(),
      ...(signal === undefined ? {} : { signal }),
    });
    const activityId = response.headers.get("X-Plex-Activity");
    if (activityId !== null && activityId.length === 0)
      throw new IntegrationError("plex", "invalid-response");
    return { activityId };
  }
  async inventory(
    section: PlexSectionSnapshot,
    checkpoint: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<PlexPartInventory> {
    const parts: PlexPartInventory["parts"] = [];
    const keys = new Set<string>();
    const partIds = new Set<number>();
    let total: number | undefined;
    let offset = 0;
    do {
      await checkpoint();
      const page = await this.library.libraryPage(
        {
          sectionId: section.sectionId,
          kind: section.kind,
          offset,
          limit: 500,
        },
        signal,
      );
      if (
        page.total > 100_000 ||
        (total !== undefined && total !== page.total) ||
        page.items.length > 500 ||
        offset + page.items.length > page.total
      )
        throw new IntegrationError("plex", "invalid-response");
      total = page.total;
      for (const item of page.items) {
        if (
          keys.has(item.ratingKey) ||
          item.type !== section.kind ||
          item.Media === undefined ||
          item.Media.length === 0
        )
          throw new IntegrationError("plex", "invalid-response");
        keys.add(item.ratingKey);
        collectParts(item, parts, partIds);
      }
      offset += page.items.length;
    } while (offset < total);
    parts.sort((a, b) => a.path.localeCompare(b.path) || a.partId - b.partId);
    return {
      itemCount: keys.size,
      parts,
      digest: createHash("sha256")
        .update(JSON.stringify({ itemCount: keys.size, parts }))
        .digest("hex"),
    };
  }
  /** Read-only operator evidence. Plex DELETE also deletes bytes and is deliberately not exposed. */
  async inspectProbeMetadata(
    ratingKey: string,
    ownedPaths: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ paths: string[]; allPartsMatchProbes: boolean }> {
    z.string().regex(/^\d+$/u).parse(ratingKey);
    if (ownedPaths.length === 0 || ownedPaths.length > 2)
      throw new Error("Exact probe paths required");
    const item = await this.library.metadata(ratingKey, signal);
    const media = item.Media;
    if (
      media === undefined ||
      media.length === 0 ||
      media.some((version) => version.Part.length === 0)
    )
      throw new IntegrationError("plex", "conflict");
    const paths = media.flatMap((version) =>
      version.Part.map((part) => part.file),
    );
    if (paths.length > 100)
      throw new IntegrationError("plex", "invalid-response");
    return {
      paths,
      allPartsMatchProbes: paths.every((path) => ownedPaths.includes(path)),
    };
  }
  private headers() {
    return {
      "X-Plex-Token": this.config.token,
      "X-Plex-Client-Identifier": this.config.clientIdentifier,
      Accept: "application/json",
    };
  }
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    return await json(
      await request(
        this.transport,
        "plex",
        endpoint(this.config.baseUrl, path),
        {
          headers: this.headers(),
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      "plex",
    );
  }
}

function collectParts(
  item: PlexItem,
  parts: PlexPartInventory["parts"],
  partIds: Set<number>,
): void {
  for (const media of item.Media ?? []) {
    if (media.Part.length === 0)
      throw new IntegrationError("plex", "invalid-response");
    for (const part of media.Part) {
      if (partIds.has(part.id) || parts.length >= 200_000)
        throw new IntegrationError("plex", "invalid-response");
      partIds.add(part.id);
      parts.push({
        ratingKey: item.ratingKey,
        partId: part.id,
        path: part.file,
      });
    }
  }
}
