import { afterAll } from "vitest";
import { rm } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { queueCurrentSubtitleTargets } from "./queue.ts";
import { SubtitleWorkSchema } from "./authority.ts";
import type { FetchTransport } from "#integrations/http.ts";
import type { Database } from "#infrastructure/database.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";

export const SubtitleInputSchema = SubtitleWorkSchema.extend({
  operationId: z.string(),
  assetId: z.string(),
  targetAuthority: z.string(),
  forced: z.boolean(),
  hearingImpaired: z.enum(["required", "excluded", "any"]),
});
export function targetHarness() {
  const harness = automationTestHarness();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  async function setup(options: { speechVideo?: boolean } = {}) {
    const db = harness.database();
    const content =
      options.speechVideo === true
        ? await movieVideoFixture(1920, [], { speech: true })
        : undefined;
    const f = await fileFixture(db, undefined, {
      sourceFilename: "Test.Film.2026.1080p.WEB-DL.H264-GROUP.mkv",
      ...(content === undefined ? {} : { sourceContent: content }),
    });
    directories.push(f.directory);
    if (options.speechVideo === true) f.context.inspect = inspectMedia;
    const video = await f.published();
    const asset = await db.libraryAsset.update({
      where: { id: video.entry.assetId },
      data: {
        plexPublishedAt: new Date(),
      },
    });
    await db.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
    await db.mediaUser.update({
      where: { id: f.user.id },
      data: {
        email: "fixture@example.test",
        emailVerifiedAt: new Date(),
        notificationPreference: { create: { emailEnabled: true } },
      },
    });
    const policy = await db.mediaSubtitlePolicyVersion.create({
      data: {
        mediaId: f.media.id,
        actorId: f.user.id,
        version: 0,
        recoveryEpoch: 0,
        source: { fixture: true },
        rules: {
          schemaVersion: 1,
          protectedReasons: [],
          targets: [false, true].map((forced, index) => ({
            sourceItemId: index + 1,
            language: "en",
            audioLanguage: "en",
            forced,
            hearingImpaired: forced ? "excluded" : "any",
            audio: "any",
          })),
        },
      },
    });
    const credential = await db.credential.create({
      data: {
        kind: "provider",
        ciphertext: harness.cipher.encrypt(
          JSON.stringify({
            apiKey: "fixture",
            userAgent: "fixture",
            username: "fixture",
            password: "fixture",
          }),
          "provider:opensubtitles",
        ),
      },
    });
    await db.mediaProvider.upsert({
      where: { id: "opensubtitles" },
      create: {
        id: "opensubtitles",
        enabled: true,
        credentialId: credential.id,
      },
      update: { enabled: true, credentialId: credential.id },
    });
    await db.providerLease.deleteMany({
      where: { providerId: "opensubtitles" },
    });
    const queue = () =>
      db.$transaction((tx) =>
        queueCurrentSubtitleTargets(tx, { assetId: asset.id, epoch: 0 }),
      );
    const inputs = async () => {
      const rows = await db.operation.findMany({
        where: { kind: "acquire_subtitles", targetId: asset.id },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => SubtitleInputSchema.parse(row.payload));
    };
    return {
      ...f,
      db,
      video,
      asset,
      policy,
      videoBytes: content,
      queue,
      inputs,
      network: harness.context(),
    };
  }
  async function assrt(db: Database) {
    const credential = await db.credential.create({
      data: {
        kind: "provider",
        ciphertext: harness.cipher.encrypt(
          JSON.stringify({ token: "fixture" }),
          "provider:assrt",
        ),
      },
    });
    await db.mediaProvider.upsert({
      where: { id: "assrt" },
      create: { id: "assrt", enabled: true, credentialId: credential.id },
      update: { enabled: true, credentialId: credential.id },
    });
    await db.providerLease.deleteMany({
      where: { providerId: "assrt" },
    });
    const calls: string[] = [];
    const text =
      "1\n00:00:00,000 --> 00:00:01,000\n这是我们的国家，欢迎来到这里\n";
    const transport: FetchTransport = (url) => {
      calls.push(url.pathname);
      return Promise.resolve(
        url.hostname === "api.assrt.net"
          ? Response.json({
              status: 0,
              sub: {
                subs: [
                  {
                    id: 42,
                    videoname: "人工翻译",
                    producer: { source: "人工翻译" },
                    filelist: [
                      {
                        f: "Test.Film.2026.1080p.WEB-DL.H264-GROUP.zh-Hans.srt",
                        url: "https://file0.assrt.net/fixture",
                      },
                    ],
                  },
                ],
              },
            })
          : new Response(text),
      );
    };
    return { transport, calls };
  }
  return { ...harness, setup, assrt };
}

export function subtitleTransport(
  metadata: "correct" | "wrong" | "unknown" = "correct",
) {
  const calls: { path: string; query: URLSearchParams; body: unknown }[] = [];
  function response(url: URL, init: RequestInit) {
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, query: url.searchParams, body });
    if (url.pathname.endsWith("/login"))
      return Response.json({ token: "fixture" });
    if (url.pathname.endsWith("/subtitles")) {
      const forced = url.searchParams.get("foreign_parts_only") === "only";
      return searchResponse(forced, metadata);
    }
    if (url.pathname.endsWith("/download")) {
      const input = z.object({ file_id: z.number() }).parse(body);
      return Response.json({
        link: `https://dl.opensubtitles.com/${String(input.file_id)}.srt`,
        file_name: `Test.Film.2026.1080p.WEB-DL.H264-GROUP.en${input.file_id === 2 ? ".forced" : ""}.srt`,
      });
    }
    if (url.hostname === "dl.opensubtitles.com")
      return new Response(
        `1\n00:00:01,000 --> 00:00:02,000\nCaption ${nodePath.basename(url.pathname)}\n`,
      );
    throw new Error("Unexpected fixture endpoint");
  }
  const transport: FetchTransport = (url, init) =>
    Promise.resolve(response(url, init));
  return { transport, calls };
}

function searchResponse(
  forced: boolean,
  metadata: "correct" | "wrong" | "unknown",
) {
  return Response.json({
    total_pages: 1,
    data: [
      {
        id: forced ? "2" : "1",
        attributes: {
          language: "en",
          release: "human",
          ai_translated: false,
          machine_translated: false,
          ...(metadata === "unknown"
            ? {}
            : {
                foreign_parts_only: metadata === "wrong" ? !forced : forced,
                hearing_impaired: false,
              }),
          files: [
            {
              file_id: forced ? 2 : 1,
              file_name: `Test.Film.2026.1080p.WEB-DL.H264-GROUP.en${forced ? ".forced" : ""}.srt`,
            },
          ],
        },
      },
    ],
  });
}
