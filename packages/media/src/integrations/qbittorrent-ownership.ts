import nodePath from "node:path";
import { z } from "zod";
import { IntegrationError } from "./http.ts";

export function validateSavePath(path: string): void {
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

export const QbittorrentOperationSchema = z.uuid().regex(/^[a-f0-9-]+$/u);
const OperationSchema = QbittorrentOperationSchema;

/** Shared literal qBit ownership validation; no client, credentials or network access. */
export function assertTorrentOwnership(
  observation: {
    save_path: string;
    tags: string;
    category: string;
    auto_tmm: boolean;
  },
  input: { operationId: string; attemptId: string; savePath: string },
  category: string,
): void {
  OperationSchema.parse(input.operationId);
  OperationSchema.parse(input.attemptId);
  if (!nodePath.posix.isAbsolute(input.savePath))
    throw new Error("Expected an absolute ownership path");
  validateSavePath(input.savePath.replace(/\/$/u, ""));
  if (
    input.savePath.replace(/\/$/u, "") !== `/downloads/media/${input.attemptId}`
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
    observation.category !== category ||
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
