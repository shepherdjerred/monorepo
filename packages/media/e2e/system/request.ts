import { z } from "zod";
import { CommandResultSchema, MediaDetailSchema } from "#shared/api.ts";
import { UserSchema } from "#shared/contract.ts";
import { MovieEditionContextV3Schema } from "#shared/movie-editions/view.ts";
import {
  MovieRequestResultV3Schema,
  MovieRequestV3Schema,
} from "#shared/movie-editions/commands.ts";
import { SystemHttpBrowser } from "#testing/system/browser.ts";
import { PlexProfilesSchema } from "#shared/plex-admin.ts";
import { SYSTEM_MOVIE } from "#testing/system/external.ts";

async function json(
  response: Response,
  expectedStatus: number,
): Promise<unknown> {
  if (response.status !== expectedStatus)
    throw new Error(
      `System HTTP command returned ${String(response.status)}; expected ${String(expectedStatus)}`,
    );
  return response.json();
}

export async function requestSystemMovie(origin: string) {
  const browser = new SystemHttpBrowser(origin);
  const started = await browser.request("/api/v1/auth/plex/start", {
    method: "POST",
  });
  const pin = z
    .object({ id: z.uuid(), authorizationUrl: z.url() })
    .parse(await json(started, 201));
  const authorized = await fetch(pin.authorizationUrl);
  if (!authorized.ok)
    throw new Error("External synthetic authorization failed");
  const poll = await browser.request(`/api/v1/auth/plex/poll/${pin.id}`, {
    method: "POST",
  });
  const account = z
    .object({ status: z.literal("authenticated"), user: UserSchema })
    .parse(await json(poll, 200));
  const created = await browser.request("/api/v1/admin/profiles", {
    key: crypto.randomUUID(),
    body: {
      name: "System WEB 1080p",
      expectedVersion: 0,
      rules: {
        qualities: ["WEB-1080p"],
        rejectedCodecs: [],
        requiredAudioLanguages: [],
        minimumBytes: 1,
        maximumBytes: 10_000_000,
        minimumScore: 0,
        tagScores: {},
        cutoffQuality: "WEB-1080p",
        cutoffScore: 0,
      },
    },
  });
  const { profileId } = CommandResultSchema.parse(await json(created, 202));
  if (profileId === undefined)
    throw new Error("Created profile identity missing");
  const defaults = await browser.request(
    "/api/v1/admin/profile-defaults/movie",
    {
      method: "PUT",
      key: crypto.randomUUID(),
      body: { expectedVersion: 0, profileId },
    },
  );
  await json(defaults, 200);
  const adopted = await browser.request("/api/v1/catalog/adopt", {
    key: crypto.randomUUID(),
    body: { kind: "movie", externalId: SYSTEM_MOVIE.id },
  });
  const { mediaId } = z
    .object({ mediaId: z.uuid() })
    .parse(await json(adopted, 201));
  const choices = await browser.request(
    `/api/v3/media/${mediaId}/movie-edition-context`,
  );
  const context = MovieEditionContextV3Schema.parse(await json(choices, 200));
  const selected = context.options.find(
    (option) => option.edition === "default",
  );
  if (selected === undefined)
    throw new Error("Explicit unmarked choice missing");
  const input = MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId,
    subjectUserId: account.user.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: selected.targetVersion,
      definition: selected.storedDefinition,
      request:
        selected.request === null
          ? null
          : {
              id: selected.request.id,
              version: selected.request.version,
              choiceRevision: selected.request.choiceRevision,
            },
    },
    selection: {
      edition: "default",
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: ["en"] },
  });
  const key = crypto.randomUUID();
  const route = `/api/v3/media/${mediaId}/movie-requests`;
  const response = await browser.request(route, { key, body: input });
  const request = MovieRequestResultV3Schema.parse(await json(response, 200));
  const replay = await browser.request(route, { key, body: input });
  const replayed = MovieRequestResultV3Schema.parse(await json(replay, 200));
  if (JSON.stringify(replayed) !== JSON.stringify(request))
    throw new Error("HTTP command replay changed its durable response");
  const operationId = z.uuid().parse(request.operationId);
  return {
    browser,
    mediaId,
    userId: account.user.id,
    operationId,
    request,
    available: async (assetId: string) => {
      const profilesResponse = await browser.request(
        "/api/v1/admin/plex/profiles",
      );
      PlexProfilesSchema.parse(await json(profilesResponse, 200));
      const detailResponse = await browser.request(`/api/v1/media/${mediaId}`);
      const detail = MediaDetailSchema.parse(await json(detailResponse, 200));
      const own = detail.visibility.movieRequests.find(
        (row) => row.requestId === request.requestId,
      );
      if (
        detail.availability !== "available" ||
        !detail.visibility.playback.playable ||
        detail.visibility.playback.currentAssetId !== assetId ||
        own?.fulfillment.status !== "fulfilled"
      )
        throw new Error(
          "The requester cannot see the completed playable edition through HTTP",
        );
      const current = detail.assets.find(
        (row) => row.current && row.asset.id === assetId,
      );
      if (current === undefined || current.asset.subtitles.length > 0)
        throw new Error(
          "The video-before-subtitles scenario did not expose the expected current asset",
        );
      return detail;
    },
  };
}
