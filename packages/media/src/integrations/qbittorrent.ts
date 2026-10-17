import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { torrentInfoHashes } from "./torrent.ts";
import nodePath from "node:path";

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
const OperationSchema = z.string().regex(/^[\w-]{1,100}$/u);
const TorrentSchema = z.object({
  hash: HashSchema,
  name: z.string(),
  state: z.string(),
  category: z.string(),
  tags: z.string(),
  progress: z.number().min(0).max(1),
  ratio: z.number().nonnegative(),
  seeding_time: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  save_path: z.string(),
  content_path: z.string(),
});
const FileSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  priority: z.number().int(),
});

export type TorrentObservation = z.infer<typeof TorrentSchema>;
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
    if (config.category.length === 0)
      throw new Error("Managed torrent category is required");
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
    const cookie = response.headers
      .get("set-cookie")
      ?.match(/(?:^|,\s*)SID=([^;\s,]+)/u)?.[1];
    if (cookie === undefined || body.trim() !== "Ok.")
      throw new IntegrationError("qbittorrent", "authentication");
    this.cookie = `SID=${cookie}`;
  }

  async list(signal?: AbortSignal): Promise<TorrentObservation[]> {
    const response = await this.call(
      "torrents/info",
      "GET",
      { category: this.config.category },
      signal,
    );
    return z.array(TorrentSchema).parse(await json(response, "qbittorrent"));
  }

  /** Inventory every category before proving that source paths are not shared. */
  async listAll(signal?: AbortSignal): Promise<TorrentObservation[]> {
    return z
      .array(TorrentSchema)
      .parse(
        await json(
          await this.call("torrents/info", "GET", {}, signal),
          "qbittorrent",
        ),
      );
  }

  validateOwnership(
    observation: TorrentObservation,
    input: { operationId: string; savePath: string },
  ): void {
    OperationSchema.parse(input.operationId);
    if (!nodePath.posix.isAbsolute(input.savePath))
      throw new Error("Expected an absolute ownership path");
    validateSavePath(nodePath.posix.resolve(input.savePath));
    if (
      !nodePath.posix.isAbsolute(observation.save_path) ||
      nodePath.posix.resolve(observation.save_path) !==
        nodePath.posix.resolve(input.savePath) ||
      observation.category !== this.config.category ||
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
    const response = await this.call(
      "torrents/info",
      "GET",
      { hashes: hash },
      signal,
    );
    const torrents = z
      .array(TorrentSchema)
      .parse(await json(response, "qbittorrent"));
    if (torrents.length > 1 || torrents.some((item) => item.hash !== hash))
      throw new IntegrationError("qbittorrent", "invalid-response");
    return torrents[0] ?? null;
  }

  async files(hash: string, signal?: AbortSignal): Promise<TorrentFile[]> {
    HashSchema.parse(hash);
    const response = await this.call("torrents/files", "GET", { hash }, signal);
    return z.array(FileSchema).parse(await json(response, "qbittorrent"));
  }

  /** Caller journals submission before this call; a lost response requires observe(), not blind resubmission. */
  async submit(
    input: {
      operationId: string;
      hash: string;
      magnet: string;
      savePath?: string;
    },
    signal?: AbortSignal,
  ): Promise<"accepted" | "already-present"> {
    OperationSchema.parse(input.operationId);
    HashSchema.parse(input.hash);
    if (input.savePath !== undefined) validateSavePath(input.savePath);
    const magnet = new URL(input.magnet);
    if (magnet.protocol !== "magnet:") throw new Error("Expected a magnet URI");
    const identities = magnet.searchParams.getAll("xt");
    if (
      !identities.some(
        (identity) =>
          identity.toLowerCase() === `urn:btih:${input.hash}` ||
          identity.toLowerCase() === `urn:btmh:1220${input.hash}`,
      )
    ) {
      throw new Error("Magnet identity does not match acquisition hash");
    }
    const existing = await this.observe(input.hash, signal);
    const tag = `media-${input.operationId}`;
    if (existing !== null) {
      this.validateOwnership(existing, {
        operationId: input.operationId,
        savePath: input.savePath ?? existing.save_path,
      });
      return "already-present";
    }
    const response = await this.call(
      "torrents/add",
      "POST",
      {
        urls: input.magnet,
        ...(input.savePath === undefined ? {} : { savepath: input.savePath }),
        category: this.config.category,
        tags: tag,
        autoTMM: "false",
        ratioLimit: "-1",
        seedingTimeLimit: "-1",
        inactiveSeedingTimeLimit: "-1",
      },
      signal,
    );
    const responseBody = await response.text();
    if (responseBody.trim() !== "Ok.")
      throw new IntegrationError("qbittorrent", "outcome-unknown");
    return "accepted";
  }

  /** Policy and dependency checks must already be committed by the calling Activity. */
  async submitTorrent(
    input: {
      operationId: string;
      hash: string;
      bytes: Uint8Array<ArrayBuffer>;
      savePath?: string;
    },
    signal?: AbortSignal,
  ): Promise<"accepted" | "already-present"> {
    OperationSchema.parse(input.operationId);
    HashSchema.parse(input.hash);
    if (input.savePath !== undefined) validateSavePath(input.savePath);
    const hashes = torrentInfoHashes(input.bytes);
    if (input.hash !== hashes.v1 && input.hash !== hashes.v2)
      throw new IntegrationError("qbittorrent", "conflict");
    const existing = await this.observe(input.hash, signal);
    const tag = `media-${input.operationId}`;
    if (existing !== null) {
      this.validateOwnership(existing, {
        operationId: input.operationId,
        savePath: input.savePath ?? existing.save_path,
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
    if (input.savePath !== undefined) form.set("savepath", input.savePath);
    form.set("tags", tag);
    form.set("autoTMM", "false");
    form.set("ratioLimit", "-1");
    form.set("seedingTimeLimit", "-1");
    form.set("inactiveSeedingTimeLimit", "-1");
    const url = endpoint(this.config.baseUrl, "api/v2/torrents/add");
    const response = await request(this.transport, "qbittorrent", url, {
      method: "POST",
      headers: { Cookie: this.cookie, Origin: url.origin },
      body: form,
      mutation: true,
      ...(signal === undefined ? {} : { signal }),
    });
    const body = await response.text();
    if (body.trim() !== "Ok.")
      throw new IntegrationError("qbittorrent", "outcome-unknown");
    return "accepted";
  }

  /** Policy and dependency checks must already be committed by the calling Activity. */
  async remove(
    input: { hash: string; operationId: string; deleteFiles: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    HashSchema.parse(input.hash);
    OperationSchema.parse(input.operationId);
    const existing = await this.observe(input.hash, signal);
    if (existing === null) return;
    if (
      existing.category !== this.config.category ||
      !existing.tags
        .split(",")
        .map((value) => value.trim())
        .includes(`media-${input.operationId}`)
    ) {
      throw new IntegrationError("qbittorrent", "conflict");
    }
    await this.call(
      "torrents/delete",
      "POST",
      { hashes: input.hash, deleteFiles: String(input.deleteFiles) },
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
