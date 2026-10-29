import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { retainedMovieCandidate } from "#infrastructure/movie-editions/lifecycle/candidate.test-support.ts";
import { storeMovieCandidateV4 } from "#automation/movie-editions/candidates.ts";
import { reserveMovieCandidateV4 } from "#automation/movie-editions/reservation.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
import { observeMovieAcquisitionV4 } from "#automation/movie-editions/observation.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

type Base = Awaited<
  ReturnType<ReturnType<typeof automationTestHarness>["fixture"]>
>;

/** Real consent, provider, reservation, submission and member observation; only external HTTP/mount attestations are synthetic. */
export async function movieFilesV4Fixture(
  db: Database,
  network: MediaAutomationContext,
  base: Base,
  input: { bytes: Uint8Array; edition?: MovieEditionKey; memberName?: string },
) {
  const files = await mappedPublicationFixture(db);
  try {
    const edition = input.edition ?? "extended_cut";
    const media = await db.mediaItem.update({
      where: { id: base.media.id },
      data: {
        tmdbId:
          z.int().parse(crypto.getRandomValues(new Uint32Array(1))[0]) %
          2_000_000_000,
        runtimeMinutes: 1,
        originalLanguage: "en",
      },
    });
    await db.qualityProfileDefault.upsert({
      where: { kind: "movie" },
      create: { kind: "movie", profileId: base.profile.id },
      update: { profileId: base.profile.id },
    });
    const requested = await requestTestMovieV4(
      db,
      base.user,
      media.id,
      edition,
    );
    const candidate = await retainedMovieCandidate(network, {
      ...base,
      media,
      edition,
      source: { ...base.source, sizeBytes: input.bytes.byteLength },
    });
    const name = input.memberName ?? `${candidate.source.title}.mkv`;
    let observed: Record<string, unknown> | null = null;
    const context = {
      ...network,
      qbittorrent: new QbittorrentClient(
        {
          baseUrl: "http://qbit.fixture",
          username: "fixture",
          password: "fixture",
          category: "media",
        },
        (url, init) => {
          if (url.pathname.endsWith("/auth/login"))
            return Promise.resolve(
              new Response("Ok.", {
                headers: { "Set-Cookie": "SID=fixture" },
              }),
            );
          if (url.pathname.endsWith("/torrents/info"))
            return Promise.resolve(
              Response.json(observed === null ? [] : [observed]),
            );
          if (url.pathname.endsWith("/torrents/files"))
            return Promise.resolve(
              Response.json([
                {
                  index: 0,
                  name,
                  size: input.bytes.byteLength,
                  progress: 1,
                  priority: 1,
                },
              ]),
            );
          if (
            !url.pathname.endsWith("/torrents/add") ||
            !(init.body instanceof URLSearchParams)
          )
            throw new TypeError("Unexpected movie qBit fixture request");
          const hash = candidate.source.infoHash;
          observed = {
            hash,
            infohash_v1: hash,
            infohash_v2: "",
            tags: init.body.get("tags"),
            save_path: init.body.get("savepath"),
            content_path: `${String(init.body.get("savepath"))}/${name}`,
            name,
            state: "uploading",
            category: "media",
            progress: 1,
            ratio: 0,
            seeding_time: 0,
            size: input.bytes.byteLength,
            ratio_limit: -1,
            seeding_time_limit: -1,
            inactive_seeding_time_limit: -1,
            max_ratio: -1,
            max_seeding_time: -1,
            max_inactive_seeding_time: -1,
            share_limit_action: "Stop",
            auto_tmm: false,
            force_start: false,
          };
          return Promise.resolve(
            Response.json({
              added_torrent_ids: [hash],
              success_count: 1,
              failure_count: 0,
              pending_count: 0,
            }),
          );
        },
      ),
    };
    const selected = await storeMovieCandidateV4(
      context,
      requested.input.scope,
      candidate.source,
    );
    if (selected === null)
      throw new Error("Actual provider source did not satisfy movie policy");
    const attemptId = await reserveMovieCandidateV4(
      context,
      requested.input,
      selected,
      0,
    );
    if (attemptId === null)
      throw new Error("Actual named movie reservation failed");
    const source = path.join(files.roots.downloads, "media", attemptId, name);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, input.bytes, { flag: "wx" });
    const operation = {
      schemaVersion: 4 as const,
      operationId: requested.input.operationId,
      attemptId,
      scope: requested.input.scope,
    };
    const submitted = await submitMovieTorrentV4(context, operation);
    if (submitted.status !== "submitted")
      throw new Error(
        `Actual movie fixture submission failed: ${submitted.reason ?? submitted.status}`,
      );
    const ready = await observeMovieAcquisitionV4(context, operation);
    if (ready.status !== "ready")
      throw new Error(
        `Actual movie fixture observation failed: ${ready.reason ?? ready.status}`,
      );
    files.context.inspect = inspectMedia;
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return {
      ...requested,
      media,
      files,
      context,
      candidate,
      source,
      attempt,
      input: operation,
    };
  } catch (error) {
    await rm(files.directory, { recursive: true, force: true });
    throw error;
  }
}
