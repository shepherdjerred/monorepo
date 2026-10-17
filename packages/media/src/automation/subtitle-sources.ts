import nodePath from "node:path";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  AssrtProvider,
  OpenSubtitlesProvider,
} from "#integrations/subtitle-providers.ts";
import { IntegrationError } from "#integrations/http.ts";
import { extractSubtitleArchive } from "#filesystem/subtitle-archive.ts";
import type { MediaAutomationContext } from "./context.ts";

export type SubtitleSource = {
  filename: string;
  description: string;
  bytes: Uint8Array<ArrayBuffer>;
  actualLanguage: string;
  declaredEncoding?: "utf8" | "utf-16le" | "utf-16be" | "gb18030";
};
export type SubtitleSearch = {
  operationId: string;
  sourceFilename: string;
  query: string;
  language: string;
  season?: number;
  episode?: number;
};
const normalize = (name: string) =>
  nodePath
    .basename(name)
    .replace(/\.(?:mkv|mp4|avi|m4v|srt|ass|ssa|vtt)$/iu, "")
    .replace(/[. _-](?:zh[._-]?(?:cn|hans)|chs|eng|en|简体|简中)$/iu, "")
    .toLowerCase()
    .replaceAll(/[ ._-]+/gu, ".");

/** Full release/version stem equality is deliberately stricter than title matching. */
export function subtitleVersionMatches(
  filename: string,
  sourceFilename: string,
): boolean {
  return normalize(filename) === normalize(sourceFilename);
}

export async function subtitleArchive(
  bytes: Uint8Array<ArrayBuffer>,
  input: SubtitleSearch,
  description: string,
): Promise<SubtitleSource> {
  let filename = "";
  const content = await extractSubtitleArchive({
    bytes,
    temporaryRoot: await realpath(tmpdir()),
    member: (members) => {
      const matches = members.filter(
        (member) =>
          !member.directory &&
          /\.(?:srt|ass|ssa|vtt)$/iu.test(member.name) &&
          subtitleVersionMatches(member.name, input.sourceFilename),
      );
      if (matches.length !== 1 || matches[0] === undefined)
        throw new IntegrationError("subtitles", "interaction-required");
      filename = matches[0].name;
      return filename;
    },
  });
  return {
    filename,
    description,
    bytes: content,
    actualLanguage: input.language,
  };
}

export async function subtitleCredential(
  context: MediaAutomationContext,
  id: string,
): Promise<unknown> {
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id },
  });
  if (provider.credentialId === null)
    throw new IntegrationError(id, "authentication");
  const credential = await context.db.credential.findUniqueOrThrow({
    where: { id: provider.credentialId },
  });
  return JSON.parse(
    context.cipher.decrypt(credential.ciphertext, `provider:${id}`),
  );
}

/** A durable claim prevents quota-consuming download-link calls from being blindly replayed. */
export async function claimSubtitleDownload(
  context: MediaAutomationContext,
  input: SubtitleSearch,
  providerId: string,
  candidateId: string,
): Promise<void> {
  await context.db.$transaction(async (tx) => {
    const operation = await tx.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const existing = z
      .object({ subtitleDownload: z.unknown().optional() })
      .parse(operation.result ?? {});
    if (existing.subtitleDownload !== undefined)
      throw new IntegrationError(providerId, "outcome-unknown");
    const changed = await tx.operation.updateMany({
      where: { id: operation.id, updatedAt: operation.updatedAt },
      data: {
        result: {
          subtitleDownload: {
            providerId,
            candidateId,
            requestedAt: new Date().toISOString(),
          },
        },
      },
    });
    if (changed.count !== 1) throw new IntegrationError(providerId, "conflict");
    await tx.applicationEvent.create({
      data: {
        kind: "subtitle_download_requested",
        payload: { operationId: operation.id, providerId, candidateId },
      },
    });
  });
}

export async function fromOpenSubtitles(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleSource | null> {
  const credential = z
    .object({
      apiKey: z.string(),
      userAgent: z.string(),
      username: z.string(),
      password: z.string(),
    })
    .parse(await subtitleCredential(context, "opensubtitles"));
  const provider = new OpenSubtitlesProvider(credential);
  await provider.login(credential.username, credential.password);
  const language = ["zh-Hans", "zh-CN"].includes(input.language)
    ? "zh-cn"
    : input.language;
  const result = await provider.search({
    query: input.query,
    language,
    ...(input.season === undefined ? {} : { season: input.season }),
    ...(input.episode === undefined ? {} : { episode: input.episode }),
  });
  for (const candidate of result.candidates.slice(0, 10)) {
    if (candidate.attributes.language !== language) continue;
    const files = candidate.attributes.files.filter((file) =>
      subtitleVersionMatches(file.file_name, input.sourceFilename),
    );
    if (files.length !== 1 || files[0] === undefined) continue;
    await claimSubtitleDownload(
      context,
      input,
      "opensubtitles",
      String(files[0].file_id),
    );
    const downloaded = await provider.download(files[0].file_id);
    if (!subtitleVersionMatches(downloaded.filename, input.sourceFilename))
      throw new IntegrationError("opensubtitles", "conflict");
    return {
      ...downloaded,
      description: candidate.attributes.release,
      actualLanguage: input.language,
    };
  }
  return null;
}

export async function fromAssrt(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleSource | null> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
  const credential = z
    .object({ token: z.string() })
    .parse(await subtitleCredential(context, "assrt"));
  const provider = new AssrtProvider(credential.token);
  const candidates = await provider.search(input.query);
  for (const candidate of candidates.slice(0, 5)) {
    if (!("id" in candidate)) continue;
    const detail = await provider.detail(candidate.id);
    const members =
      detail.filelist?.filter((file) =>
        subtitleVersionMatches(file.f, input.sourceFilename),
      ) ?? [];
    if (members.length !== 1 || members[0] === undefined) continue;
    await claimSubtitleDownload(
      context,
      input,
      "assrt",
      `${String(candidate.id)}:${members[0].f}`,
    );
    const bytes = await provider.downloadMember(candidate.id, members[0].f);
    return {
      filename: members[0].f,
      description: `${detail.videoname ?? ""} ${detail.producer?.source ?? ""}`,
      bytes,
      actualLanguage: input.language,
    };
  }
  return null;
}
