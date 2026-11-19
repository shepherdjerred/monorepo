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
import type { FetchTransport } from "#integrations/http.ts";
import type { SubtitleTarget } from "#domain/subtitle-quality.ts";
import {
  subtitleProviderCandidateAllowedV1,
  type SubtitleSource,
  type SubtitleSearch,
} from "#domain/subtitle-maintenance/provider.ts";
import {
  openSubtitlesCatalogEvidenceV1,
  openSubtitlesSearchInputV1,
} from "#automation/subtitle-maintenance/provider-evidence.ts";

const normalize = (name: string) =>
  nodePath
    .basename(name)
    .replace(/\.(?:mkv|mp4|avi|m4v|srt|ass|ssa|vtt)$/iu, "")
    .replace(
      /[. _-](?:zh[._-]?(?:cn|hans)|chs|eng|en|简体|简中)(?:[. _-](?:forced|sdh|hi))*$/iu,
      "",
    )
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
    forced: null,
    hearingImpaired: null,
  };
}

export async function subtitleCredential(
  context: Pick<MediaAutomationContext, "db" | "cipher">,
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
  context: Pick<MediaAutomationContext, "db">,
  input: SubtitleSearch,
  providerId: string,
  candidateId: string,
): Promise<void> {
  if (input.downloadAuthority !== undefined) {
    input.downloadAuthority.assertActive();
    await input.downloadAuthority.authorize();
    input.downloadAuthority.assertActive();
  }
  await context.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id = ${input.operationId} FOR UPDATE`;
    const operation = await tx.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const existing = z
      .object({ subtitleDownload: z.unknown().optional() })
      .parse(operation.result ?? {});
    if (existing.subtitleDownload !== undefined)
      throw new IntegrationError(providerId, "outcome-unknown");
    const eventId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const claim = {
      subtitleDownload: {
        eventId,
        providerId,
        candidateId,
        requestedAt,
      },
    };
    await tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify(claim)}::jsonb, "updatedAt" = NOW() WHERE id = ${operation.id}`;
    await tx.applicationEvent.create({
      data: {
        id: eventId,
        kind: "subtitle_download_requested",
        payload: {
          operationId: operation.id,
          providerId,
          candidateId,
          requestedAt,
        },
      },
    });
  });
  input.downloadAuthority?.assertActive();
}

export async function fromOpenSubtitles(
  context: MediaAutomationContext,
  input: SubtitleSearch,
  transport?: FetchTransport,
): Promise<SubtitleSource | null> {
  const credential = z
    .object({
      apiKey: z.string(),
      userAgent: z.string(),
      username: z.string(),
      password: z.string(),
    })
    .parse(await subtitleCredential(context, "opensubtitles"));
  const provider = new OpenSubtitlesProvider(credential, transport);
  await provider.login(credential.username, credential.password);
  const search = openSubtitlesSearchInputV1(input);
  const { language } = search;
  const result = await provider.search(search);
  for (const candidate of result.candidates.slice(0, 10)) {
    if (candidate.attributes.language !== language) continue;
    if (
      !subtitleMetadataMatches(input, {
        forced: candidate.attributes.foreign_parts_only ?? null,
        hearingImpaired: candidate.attributes.hearing_impaired ?? null,
      })
    )
      continue;
    const files = candidate.attributes.files.filter((file) =>
      subtitleVersionMatches(file.file_name, input.sourceFilename),
    );
    if (files.length !== 1 || files[0] === undefined) continue;
    if (
      !subtitleProviderCandidateAllowedV1(
        input,
        "opensubtitles",
        String(files[0].file_id),
      )
    )
      continue;
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
      forced: candidate.attributes.foreign_parts_only ?? null,
      hearingImpaired: candidate.attributes.hearing_impaired ?? null,
      ...openSubtitlesCatalogEvidenceV1(
        input,
        candidate.attributes.feature_details,
      ),
    };
  }
  return null;
}

export async function fromAssrt(
  context: MediaAutomationContext,
  input: SubtitleSearch,
  transport?: FetchTransport,
): Promise<SubtitleSource | null> {
  if (!["zh-Hans", "zh-CN"].includes(input.language)) return null;
  requireUntargetedProvider(input, "assrt");
  const credential = z
    .object({ token: z.string() })
    .parse(await subtitleCredential(context, "assrt"));
  const provider = new AssrtProvider(credential.token, transport);
  const candidates = await provider.search(input.query);
  for (const candidate of candidates.slice(0, 5)) {
    if (!("id" in candidate)) continue;
    const detail = await provider.detail(candidate.id);
    const members =
      detail.filelist?.filter((file) =>
        subtitleVersionMatches(file.f, input.sourceFilename),
      ) ?? [];
    if (members.length !== 1 || members[0] === undefined) continue;
    if (
      !subtitleProviderCandidateAllowedV1(
        input,
        "assrt",
        `${String(candidate.id)}:${members[0].f}`,
      )
    )
      continue;
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
      forced: null,
      hearingImpaired: null,
    };
  }
  return null;
}

export function subtitleMetadataMatches(
  target: SubtitleTarget,
  source: { forced: boolean | null; hearingImpaired: boolean | null },
  allowMeasuredRegular = false,
): boolean {
  return (
    (target.forced === undefined ||
      source.forced === target.forced ||
      (allowMeasuredRegular &&
        !target.forced &&
        source.forced === null &&
        ["en", "zh-CN", "zh-Hans"].includes(target.language))) &&
    (target.hearingImpaired !== "required" ||
      source.hearingImpaired === true) &&
    (target.hearingImpaired !== "excluded" || source.hearingImpaired === false)
  );
}

export function regularDialogueRequirement(
  target: SubtitleTarget,
  source: { forced: boolean | null },
) {
  return target.forced === false && source.forced === null
    ? { regularDialogueRequiredV1: true }
    : {};
}

export function requireUntargetedProvider(
  target: SubtitleTarget,
  providerId: string,
): void {
  if (
    target.forced === true ||
    (target.hearingImpaired !== undefined && target.hearingImpaired !== "any")
  )
    throw new IntegrationError(providerId, "unsupported-target");
}
