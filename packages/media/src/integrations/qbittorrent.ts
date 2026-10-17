import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { torrentInfoHashes } from "./torrent.ts";
import { magnetTorrentIds } from "./magnet.ts";
import nodePath from "node:path";
import {
  TorrentPolicySchema,
  TorrentRatioSchema,
  hasApplicationSeedingPolicy,
} from "./qbittorrent-policy.ts";

function validateSavePath(path: string): void {
  if (
    !path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("\\") ||
    path
      .slice(1)
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error("Expected an explicit absolute torrent save path");
}

const HashSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const OperationSchema = z.uuid().regex(/^[a-f0-9-]+$/u);
function submissionTags(input: {
  operationId: string;
  attemptId: string;
  savePath: string;
}): string {
  OperationSchema.parse(input.operationId);
  OperationSchema.parse(input.attemptId);
  validateSavePath(input.savePath);
  if (input.savePath !== `/downloads/media/${input.attemptId}`)
    throw new Error("Submission path must be isolated by acquisition attempt");
  return `media-${input.operationId},media-attempt-${input.attemptId}`;
}
// Pinned qBittorrent 5.2.4 / WebAPI 2.15.1. Older "Ok." replies are not accepted.
const AddResultSchema = z.object({
  added_torrent_ids: z.array(HashSchema),
  failure_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  success_count: z.number().int().nonnegative(),
});

async function requireAcceptedAdd(
  response: Response,
  expectedIds: readonly string[],
): Promise<void> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new IntegrationError("qbittorrent", "outcome-unknown");
  }
  const result = AddResultSchema.safeParse(body);
  if (
    !result.success ||
    result.data.failure_count !== 0 ||
    result.data.pending_count !== 0 ||
    result.data.success_count !== 1 ||
    result.data.added_torrent_ids.length !== 1 ||
    !expectedIds.includes(result.data.added_torrent_ids[0] ?? "")
  )
    throw new IntegrationError("qbittorrent", "outcome-unknown");
}
export const TorrentObservationSchema = TorrentPolicySchema.extend({
  hash: z.string().regex(/^[a-f0-9]{40}$/u),
  infohash_v1: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{40}$/u)]),
  infohash_v2: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{64}$/u)]),
  name: z.string(),
  state: z.string(),
  category: z.string(),
  tags: z.string(),
  progress: z.number().min(0).max(1),
  ratio: TorrentRatioSchema,
  seeding_time: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  save_path: z.string(),
  content_path: z.string(),
});
/** Persisted observations already contain the normalized ratio, unlike the qBit wire payload. */
export const StoredTorrentObservationSchema = TorrentObservationSchema.extend({
  ratio: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("finite"),
      value: z.number().nonnegative(),
    }),
    z.strictObject({ kind: z.literal("infinite") }),
  ]),
});
const FileSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  priority: z.number().int(),
});

export type TorrentObservation = z.infer<typeof TorrentObservationSchema>;
export type TorrentFile = z.infer<typeof FileSchema>;

/** qBittorrent Web API v2. Mutations never automatically retry. */
export class QbittorrentClient {
  private cookie: string | undefined;

  constructor(
    private readonly config: {
      baseUrl: string;
      username: string;
      password: string;
      category: string;
    },
    private readonly transport: FetchTransport = fetch,
  ) {
    endpoint(config.baseUrl, "/api/v2/");
    if (config.category !== "media")
      throw new Error("The media protocol reserves category media");
  }

  async login(signal?: AbortSignal): Promise<void> {
    const response = await request(
      this.transport,
      "qbittorrent",
      endpoint(this.config.baseUrl, "api/v2/auth/login"),
      {
        method: "POST",
        headers: { Origin: new URL(this.config.baseUrl).origin },
        body: new URLSearchParams({
          username: this.config.username,
          password: this.config.password,
        }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const body = await response.text();
    const cookies = [
      ...(response.headers.get("set-cookie") ?? "").matchAll(
        /(?:^|,\s*)(QBT_SID_\d+|SID)=([^;\s,]+)/gu,
      ),
    ];
    const cookie = cookies.length === 1 ? cookies[0] : undefined;
    if (
      cookie === undefined ||
      !(
        (response.status === 204 && body.length === 0) ||
        (response.status === 200 && body.trim() === "Ok.")
      )
    )
      throw new IntegrationError("qbittorrent", "authentication");
    this.cookie = `${String(cookie[1])}=${String(cookie[2])}`;
  }

  async version(signal?: AbortSignal): Promise<string> {
    const response = await this.call("app/version", "GET", {}, signal);
    return z
      .string()
      .max(64)
      .regex(/^v?\d+\.\d+\.\d+$/u)
      .parse(await response.text());
  }

  async list(signal?: AbortSignal): Promise<TorrentObservation[]> {
    const response = await this.call(
      "torrents/info",
      "GET",
      { category: this.config.category },
      signal,
    );
    return z
      .array(TorrentObservationSchema)
      .parse(await json(response, "qbittorrent"));
  }

  /** Inventory every category before proving that source paths are not shared. */
  async listAll(signal?: AbortSignal): Promise<TorrentObservation[]> {
    return z
      .array(TorrentObservationSchema)
      .max(50_000)
      .parse(
        await json(
          await this.call("torrents/info", "GET", {}, signal),
          "qbittorrent",
        ),
      );
  }

  validateOwnership(
    observation: TorrentObservation,
    input: { operationId: string; attemptId: string; savePath: string },
  ): void {
    OperationSchema.parse(input.operationId);
    OperationSchema.parse(input.attemptId);
    if (!nodePath.posix.isAbsolute(input.savePath))
      throw new Error("Expected an absolute ownership path");
    validateSavePath(input.savePath.replace(/\/$/u, ""));
    if (
      input.savePath.replace(/\/$/u, "") !==
      `/downloads/media/${input.attemptId}`
    )
      throw new IntegrationError("qbittorrent", "conflict");
    const tags = observation.tags.split(",").map((tag) => tag.trim());
    const operationTags = tags.filter((tag) =>
      /^media-[a-f0-9-]{36}$/u.test(tag),
    );
    const attemptTags = tags.filter((tag) => tag.startsWith("media-attempt-"));
    if (
      !nodePath.posix.isAbsolute(observation.save_path) ||
      observation.save_path.replace(/\/$/u, "") !==
        nodePath.posix.resolve(input.savePath) ||
      nodePath.posix.resolve(observation.save_path) !==
        nodePath.posix.resolve(input.savePath) ||
      observation.category !== this.config.category ||
      observation.auto_tmm ||
      operationTags.length !== 1 ||
      attemptTags.length !== 1 ||
      nodePath.posix.basename(nodePath.posix.resolve(input.savePath)) !==
        input.attemptId ||
      nodePath.posix.basename(
        nodePath.posix.dirname(nodePath.posix.resolve(input.savePath)),
      ) !== "media" ||
      !observation.tags
        .split(",")
        .map((tag) => tag.trim())
        .includes(`media-attempt-${input.attemptId}`) ||
      !observation.tags
        .split(",")
        .map((tag) => tag.trim())
        .includes(`media-${input.operationId}`)
    )
      throw new IntegrationError("qbittorrent", "conflict");
  }

  async observe(
    hash: string,
    signal?: AbortSignal,
  ): Promise<TorrentObservation | null> {
    HashSchema.parse(hash);
    // WebAPI IDs are truncated v2 hashes (also for hybrid torrents). A filtered
    // lookup using the release's full SHA1/SHA256 can falsely report absence.
    const inventory = await this.listAll(signal);
    const torrents = inventory.filter(
      (item) => item.infohash_v1 === hash || item.infohash_v2 === hash,
    );
    if (torrents.length > 1)
      throw new IntegrationError("qbittorrent", "invalid-response");
    return torrents[0] ?? null;
  }

  async files(
    wireTorrentId: string,
    signal?: AbortSignal,
  ): Promise<TorrentFile[]> {
    z.string()
      .regex(/^[a-f0-9]{40}$/u)
      .parse(wireTorrentId);
    const response = await this.call(
      "torrents/files",
      "GET",
      { hash: wireTorrentId },
      signal,
    );
    return z.array(FileSchema).parse(await json(response, "qbittorrent"));
  }

  /** Caller journals submission before this call; a lost response requires observe(), not blind resubmission. */
  async submit(
    input: {
      operationId: string;
      attemptId: string;
      hash: string;
      magnet: string;
      savePath: string;
    },
    signal?: AbortSignal,
  ): Promise<"accepted" | "already-present"> {
    const tag = submissionTags(input);
    HashSchema.parse(input.hash);
    const magnetIds = magnetTorrentIds(input.magnet, input.hash);
    const existing = await this.observe(input.hash, signal);
    if (existing !== null) {
      this.validateOwnership(existing, {
        operationId: input.operationId,
        attemptId: input.attemptId,
        savePath: input.savePath,
      });
      return "already-present";
    }
    const response = await this.call(
      "torrents/add",
      "POST",
      {
        urls: input.magnet,
        savepath: input.savePath,
        category: this.config.category,
        tags: tag,
        autoTMM: "false",
        ratioLimit: "-1",
        seedingTimeLimit: "-1",
        inactiveSeedingTimeLimit: "-1",
        shareLimitAction: "Stop",
      },
      signal,
    );
    await requireAcceptedAdd(response, magnetIds);
    return "accepted";
  }

  /** Policy and dependency checks must already be committed by the calling Activity. */
  async submitTorrent(
    input: {
      operationId: string;
      attemptId: string;
      hash: string;
      bytes: Uint8Array<ArrayBuffer>;
      savePath: string;
    },
    signal?: AbortSignal,
  ): Promise<"accepted" | "already-present"> {
    const tag = submissionTags(input);
    HashSchema.parse(input.hash);
    const hashes = torrentInfoHashes(input.bytes);
    if (input.hash !== hashes.v1 && input.hash !== hashes.v2)
      throw new IntegrationError("qbittorrent", "conflict");
    const existing = await this.observe(input.hash, signal);
    if (existing !== null) {
      this.validateOwnership(existing, {
        operationId: input.operationId,
        attemptId: input.attemptId,
        savePath: input.savePath,
      });
      return "already-present";
    }
    if (this.cookie === undefined)
      throw new IntegrationError("qbittorrent", "authentication");
    const form = new FormData();
    form.set(
      "torrents",
      new Blob([input.bytes], { type: "application/x-bittorrent" }),
      "media.torrent",
    );
    form.set("category", this.config.category);
    form.set("savepath", input.savePath);
    form.set("tags", tag);
    form.set("autoTMM", "false");
    form.set("ratioLimit", "-1");
    form.set("seedingTimeLimit", "-1");
    form.set("inactiveSeedingTimeLimit", "-1");
    form.set("shareLimitAction", "Stop");
    const url = endpoint(this.config.baseUrl, "api/v2/torrents/add");
    const response = await request(this.transport, "qbittorrent", url, {
      method: "POST",
      headers: { Cookie: this.cookie, Origin: url.origin },
      body: form,
      mutation: true,
      ...(signal === undefined ? {} : { signal }),
    });
    await requireAcceptedAdd(
      response,
      [hashes.v1, hashes.v2].flatMap((hash) =>
        hash === null ? [] : [hash.slice(0, 40)],
      ),
    );
    return "accepted";
  }

  /** Policy and dependency checks must already be committed by the calling Activity. */
  async remove(
    input: {
      hash: string;
      operationId: string;
      attemptId: string;
      savePath: string;
      deleteFiles: boolean;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    HashSchema.parse(input.hash);
    OperationSchema.parse(input.operationId);
    const existing = await this.observe(input.hash, signal);
    if (existing === null) return;
    this.validateOwnership(existing, input);
    if (!hasApplicationSeedingPolicy(existing)) {
      throw new IntegrationError("qbittorrent", "conflict");
    }
    await this.call(
      "torrents/delete",
      "POST",
      { hashes: existing.hash, deleteFiles: String(input.deleteFiles) },
      signal,
    );
  }

  private async call(
    path: string,
    method: "GET" | "POST",
    values: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (this.cookie === undefined)
      throw new IntegrationError("qbittorrent", "authentication");
    const url = endpoint(this.config.baseUrl, `api/v2/${path}`);
    const parameters = new URLSearchParams(values);
    if (method === "GET") url.search = parameters.toString();
    return await request(this.transport, "qbittorrent", url, {
      method,
      headers: { Cookie: this.cookie, Origin: url.origin },
      ...(method === "POST" ? { body: parameters } : {}),
      mutation: method === "POST",
      ...(signal === undefined ? {} : { signal }),
    });
  }
}
