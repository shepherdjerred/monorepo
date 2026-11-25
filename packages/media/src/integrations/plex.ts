import { z } from "zod";
import { PlexViewCountSchema } from "#shared/plex-binding/completion.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import {
  PlexCollectionSchema,
  PlexCollectionContentsSchema,
  type PlexCollectionTarget,
} from "./plex-collections/contract.ts";
import {
  PlexDecimalIdSchema,
  PlexServerIdSchema,
} from "#shared/plex-events/contract.ts";

const ItemSchema = z.object({
  ratingKey: z.string(),
  type: z.string(),
  librarySectionID: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  title: z.string(),
  editionTitle: z.string().max(256).optional(),
  guid: z.string().optional(),
  parentRatingKey: z.string().optional(),
  grandparentRatingKey: z.string().optional(),
  index: z.number().int().optional(),
  parentIndex: z.number().int().optional(),
  year: z.number().int().optional(),
  viewCount: PlexViewCountSchema.optional(),
  lastViewedAt: z.number().int().optional(),
  Guid: z.array(z.object({ id: z.string() })).optional(),
  Media: z
    .array(
      z.object({
        Part: z.array(
          z.object({
            id: z.number().int(),
            file: z.string(),
            size: z.number().int().optional(),
          }),
        ),
      }),
    )
    .optional(),
});
const PageSchema = z.object({
  MediaContainer: z.object({
    size: z.number().int().nonnegative(),
    librarySectionID: z.int().positive().optional(),
    totalSize: z.number().int().nonnegative().optional(),
    Metadata: z.array(ItemSchema).optional(),
  }),
});
export type PlexItem = z.infer<typeof ItemSchema>;
const EditionItemSchema = ItemSchema.extend({
  type: z.literal("movie"),
  viewOffset: z.number().int().nonnegative().optional(),
});
export type PlexEditionItem = z.infer<typeof EditionItemSchema>;

function parsePage(value: unknown) {
  const parsed = PageSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError("plex", "invalid-response");
  return parsed.data;
}

/** Instantiate with each user's server token for watch observations; owner tokens are not user watch state. */
export class PlexClient {
  constructor(
    private readonly config: {
      baseUrl: string;
      token: string;
      clientIdentifier: string;
    },
    private readonly transport: FetchTransport = fetch,
  ) {
    endpoint(config.baseUrl, "/");
  }

  async machineIdentifier(signal?: AbortSignal): Promise<string> {
    return z
      .object({
        MediaContainer: z.object({ machineIdentifier: z.string().min(1) }),
      })
      .parse(await this.get("identity", {}, signal)).MediaContainer
      .machineIdentifier;
  }

  async accounts(signal?: AbortSignal) {
    const container = z
      .object({
        MediaContainer: z.object({
          size: z.number().int().nonnegative(),
          Account: z
            .array(
              z.object({
                id: z.number().int().positive(),
                name: z.string(),
                key: z.string(),
              }),
            )
            .optional(),
        }),
      })
      .parse(await this.get("accounts", {}, signal)).MediaContainer;
    if (container.size !== (container.Account?.length ?? 0))
      throw new IntegrationError("plex", "invalid-response");
    return container.Account ?? [];
  }

  async sections(signal?: AbortSignal) {
    const result = z
      .object({
        MediaContainer: z.object({
          size: z.number().int().nonnegative(),
          Directory: z
            .array(
              z.object({
                key: z.string(),
                title: z.string(),
                type: z.string(),
              }),
            )
            .optional(),
        }),
      })
      .parse(await this.get("library/sections", {}, signal)).MediaContainer;
    if (result.size !== (result.Directory?.length ?? 0))
      throw new IntegrationError("plex", "invalid-response");
    return result.Directory ?? [];
  }

  async libraryPage(
    input: {
      sectionId: string;
      kind: "movie" | "episode";
      offset: number;
      limit?: number;
    },
    signal?: AbortSignal,
  ) {
    z.string().regex(/^\d+$/u).parse(input.sectionId);
    z.number().int().nonnegative().parse(input.offset);
    const limit = z
      .number()
      .int()
      .min(1)
      .max(500)
      .parse(input.limit ?? 200);
    const page = parsePage(
      await this.get(
        `library/sections/${input.sectionId}/all`,
        {
          type: input.kind === "movie" ? "1" : "4",
          includeGuids: "1",
          "X-Plex-Container-Start": String(input.offset),
          "X-Plex-Container-Size": String(limit),
        },
        signal,
      ),
    ).MediaContainer;
    if (
      page.totalSize === undefined ||
      page.size !== (page.Metadata?.length ?? 0) ||
      (page.size === 0 && input.offset < page.totalSize)
    )
      throw new IntegrationError("plex", "invalid-response");
    return { total: page.totalSize, items: page.Metadata ?? [] };
  }

  async metadata(ratingKey: string, signal?: AbortSignal): Promise<PlexItem> {
    const { item } = await this.metadataPage(ratingKey, signal);
    return item;
  }

  private async metadataPage(ratingKey: string, signal?: AbortSignal) {
    z.string().regex(/^\d+$/u).parse(ratingKey);
    const page = parsePage(
      await this.get(
        `library/metadata/${ratingKey}`,
        { includeGuids: "1" },
        signal,
      ),
    ).MediaContainer;
    const item = page.Metadata?.[0];
    if (
      item?.ratingKey !== ratingKey ||
      page.size !== 1 ||
      page.Metadata?.length !== 1
    )
      throw new IntegrationError("plex", "invalid-response");
    return { item, sectionId: page.librarySectionID };
  }

  async observeWatch(
    ratingKey: string,
    signal?: AbortSignal,
  ): Promise<{ item: PlexItem; watched: boolean }> {
    const item = await this.metadata(ratingKey, signal);
    return { item, watched: (item.viewCount ?? 0) > 0 };
  }

  /** New edit observations retain playback progress without changing historical item projections. */
  async metadataForEditionEdit(
    ratingKey: string,
    signal: AbortSignal,
  ): Promise<PlexEditionItem> {
    z.string()
      .regex(/^[1-9]\d*$/u)
      .parse(ratingKey);
    signal.throwIfAborted();
    const parsed = z
      .object({
        MediaContainer: z.object({
          size: z.literal(1),
          Metadata: z.array(EditionItemSchema).length(1),
        }),
      })
      .safeParse(
        await this.get(
          `library/metadata/${ratingKey}`,
          { includeGuids: "1" },
          signal,
        ),
      );
    if (!parsed.success) throw new IntegrationError("plex", "invalid-response");
    const item = parsed.data.MediaContainer.Metadata[0];
    if (item?.ratingKey !== ratingKey)
      throw new IntegrationError("plex", "invalid-response");
    return item;
  }

  async watched(ratingKey: string, signal?: AbortSignal): Promise<boolean> {
    const observation = await this.observeWatch(ratingKey, signal);
    return observation.watched;
  }

  async activeSessions(signal?: AbortSignal): Promise<PlexItem[]> {
    const page = parsePage(
      await this.get("status/sessions", {}, signal),
    ).MediaContainer;
    if (page.size !== (page.Metadata?.length ?? 0))
      throw new IntegrationError("plex", "invalid-response");
    return page.Metadata ?? [];
  }

  async refresh(sectionId: string, signal?: AbortSignal): Promise<void> {
    z.string().regex(/^\d+$/u).parse(sectionId);
    await request(
      this.transport,
      "plex",
      endpoint(this.config.baseUrl, `library/sections/${sectionId}/refresh`),
      {
        method: "GET",
        headers: this.headers(),
        mutation: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  }

  async collection(target: PlexCollectionTarget, signal: AbortSignal) {
    const path = `library/metadata/${PlexDecimalIdSchema.parse(target.ratingKey)}`;
    const identity = PlexCollectionSchema.safeParse(
      await this.get(path, {}, signal),
    );
    if (!identity.success)
      throw new IntegrationError("plex", "invalid-response");
    const {
      Metadata: [item],
      librarySectionID,
    } = identity.data.MediaContainer;
    if (
      (librarySectionID !== undefined &&
        item.librarySectionID !== undefined &&
        librarySectionID !== item.librarySectionID) ||
      item.ratingKey !== target.ratingKey ||
      String(item.librarySectionID ?? librarySectionID) !== target.sectionId ||
      item.title !== target.title ||
      item.subtype !== target.sectionType
    )
      throw new IntegrationError("plex", "unsupported-target");
    const contents = PlexCollectionContentsSchema.safeParse(
      await this.get(
        path + "/children",
        { "X-Plex-Container-Start": "0", "X-Plex-Container-Size": "1001" },
        signal,
      ),
    );
    if (!contents.success)
      throw new IntegrationError("plex", "invalid-response");
    const {
      size,
      totalSize = size,
      Metadata: members = [],
    } = contents.data.MediaContainer;
    const memberKeys = new Set(members.map(({ ratingKey }) => ratingKey));
    if (
      totalSize !== size ||
      item.childCount !== size ||
      memberKeys.size !== members.length ||
      members.length !== size ||
      members.some(({ type }) => type !== target.sectionType)
    )
      throw new IntegrationError("plex", "conflict");
    return { guid: item.guid, memberKeys };
  }

  async collectionMember(ratingKey: string, signal: AbortSignal) {
    const { item, sectionId } = await this.metadataPage(ratingKey, signal);
    if (
      sectionId !== undefined &&
      item.librarySectionID !== undefined &&
      sectionId !== item.librarySectionID
    )
      throw new IntegrationError("plex", "conflict");
    return { item, sectionId: item.librarySectionID ?? sectionId };
  }

  async setCollectionMembership(
    input: {
      serverMachineId: string;
      collection: string;
      member: string;
      present: boolean;
    },
    signal: AbortSignal,
  ): Promise<void> {
    const { serverMachineId, collection, member, present } = input;
    PlexServerIdSchema.parse(serverMachineId);
    PlexDecimalIdSchema.parse(collection);
    PlexDecimalIdSchema.parse(member);
    signal.throwIfAborted();
    const items = `library/collections/${collection}/items`;
    const url = endpoint(
      this.config.baseUrl,
      present ? items : `${items}/${member}`,
    );
    if (present)
      url.searchParams.set(
        "uri",
        `server://${serverMachineId}/com.plexapp.plugins.library/library/metadata/${member}`,
      );
    const response = await request(this.transport, "plex", url, {
      method: present ? "PUT" : "DELETE",
      headers: this.headers(),
      mutation: true,
      signal,
    });
    await response.body?.cancel();
  }

  /** One existing movie only. The caller owns approval, effect checkpoints and readback. */
  async editMovieEdition(
    input: { sectionId: string; ratingKey: string; edition: MovieEditionKey },
    signal: AbortSignal,
  ): Promise<void> {
    const sectionId = z
      .string()
      .regex(/^[1-9]\d*$/u)
      .parse(input.sectionId);
    const ratingKey = z
      .string()
      .regex(/^[1-9]\d*$/u)
      .parse(input.ratingKey);
    const edition = MovieEditionKeySchema.parse(input.edition);
    signal.throwIfAborted();
    const url = endpoint(
      this.config.baseUrl,
      `library/sections/${sectionId}/all`,
    );
    url.search = new URLSearchParams({
      type: "1",
      id: ratingKey,
      "editionTitle.value": MOVIE_EDITION_REGISTRY[edition].plexLabel,
      "editionTitle.locked": "1",
    }).toString();
    await request(this.transport, "plex", url, {
      method: "PUT",
      headers: this.headers(),
      mutation: true,
      signal,
    });
  }

  private headers(): Record<string, string> {
    return {
      "X-Plex-Token": this.config.token,
      "X-Plex-Client-Identifier": this.config.clientIdentifier,
      Accept: "application/json",
    };
  }

  private async get(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = endpoint(this.config.baseUrl, path);
    url.search = new URLSearchParams(params).toString();
    return await json(
      await request(this.transport, "plex", url, {
        headers: this.headers(),
        ...(signal === undefined ? {} : { signal }),
      }),
      "plex",
    );
  }
}
