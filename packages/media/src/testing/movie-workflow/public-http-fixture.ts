import { randomBytes } from "node:crypto";
import { z } from "zod";
import { CredentialCipher } from "#application/security.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { MovieEditionContextV3Schema } from "#shared/movie-editions/view.ts";
import {
  MovieRequestResultV3Schema,
  MovieRequestV3Schema,
} from "#shared/movie-editions/commands.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { createSystemHttpServer } from "#testing/system/http.ts";
import {
  systemExternalServices,
  SYSTEM_MOVIE,
} from "#testing/system/external.ts";
import { SystemHttpBrowser } from "#testing/system/browser.ts";
import { authenticateMovieHistoryHttp } from "./history/history-http-transport.ts";

/** Actual PIN/session/HTTP/PG producers with synthetic external Plex/TMDB and a captured workflow-start boundary. */
export async function createPublicMovieHttpFixture(
  prepareHttp?: (
    http: ReturnType<typeof createSystemHttpServer>,
  ) => Promise<void>,
) {
  const cluster = await startMediaTestPostgres();
  const external = systemExternalServices();
  const db = cluster.database;
  const starts: unknown[] = [];
  let http: ReturnType<typeof createSystemHttpServer> | undefined;
  const close = async () => {
    await http?.close();
    await external.close();
    await cluster.close();
  };
  try {
    await grantTestLease(db);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
    http = createSystemHttpServer({
      ...external,
      db,
      cipher: new CredentialCipher(randomBytes(32).toString("base64")),
      plexTransport: external.transport,
      startWorkflow: (input) => {
        starts.push(input);
        return Promise.resolve();
      },
      describeWorkflow: () =>
        Promise.reject(
          new Error("HTTP acceptance cannot invent a Temporal execution"),
        ),
    });
    await prepareHttp?.(http);
    const browser = new SystemHttpBrowser(http.origin);
    const owner = await authenticateMovieHistoryHttp(browser);
    const profile = CommandResultSchema.parse(
      await publicMovieHttpJson(
        await browser.request("/api/v1/admin/profiles", {
          key: crypto.randomUUID(),
          body: {
            expectedVersion: 0,
            name: "Synthetic HTTP movie profile",
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
        }),
        202,
      ),
    );
    await publicMovieHttpJson(
      await browser.request("/api/v1/admin/profile-defaults/movie", {
        method: "PUT",
        key: crypto.randomUUID(),
        body: {
          expectedVersion: 0,
          profileId: z.uuid().parse(profile.profileId),
        },
      }),
    );
    const adopted = z.object({ mediaId: z.uuid() }).parse(
      await publicMovieHttpJson(
        await browser.request("/api/v1/catalog/adopt", {
          body: { kind: "movie", externalId: SYSTEM_MOVIE.id },
        }),
        201,
      ),
    );
    const context = MovieEditionContextV3Schema.parse(
      await publicMovieHttpJson(
        await browser.request(
          `/api/v3/media/${adopted.mediaId}/movie-edition-context`,
        ),
      ),
    );
    const selected = context.options.find(
      (option) => option.edition === "directors_cut",
    );
    if (selected === undefined)
      throw new Error("Actual context omitted the selected edition");
    const originalInput = MovieRequestV3Schema.parse({
      schemaVersion: 3,
      mediaId: adopted.mediaId,
      subjectUserId: owner.id,
      expected: {
        mediaVersion: context.mediaVersion,
        targetVersion: selected.targetVersion,
        definition: selected.storedDefinition,
        request: null,
      },
      selection: {
        edition: selected.edition,
        definitionVersion: selected.definitionVersion,
        definitionDigest: selected.definitionDigest,
        registryVersion: context.registryVersion,
      },
      options: { subtitleLanguages: ["en"] },
    });
    const originalKey = crypto.randomUUID();
    const chosen = MovieRequestResultV3Schema.parse(
      await publicMovieHttpJson(
        await browser.request(
          `/api/v3/media/${adopted.mediaId}/movie-requests`,
          {
            key: originalKey,
            body: originalInput,
          },
        ),
      ),
    );
    const originalChoice = await db.movieEditionChoice.findUniqueOrThrow({
      where: { id: chosen.choiceId },
    });
    return {
      db,
      http,
      browser,
      owner,
      starts,
      mediaId: adopted.mediaId,
      chosen,
      originalChoice,
      originalInput,
      originalKey,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function publicMovieHttpJson(
  response: Response,
  expectedStatus = 200,
): Promise<unknown> {
  const body: unknown = await response.json();
  if (response.status !== expectedStatus)
    throw new Error(
      `Movie HTTP ${String(response.status)}: ${JSON.stringify(body)}`,
    );
  return body;
}
