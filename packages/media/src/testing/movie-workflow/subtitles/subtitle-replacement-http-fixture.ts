import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { SubtitleReplacementInput } from "#shared/subtitle-replacement.ts";
import type { WorkflowStart } from "#automation/store.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { createMovieSubtitleReplacementFileFacet } from "#automation/movie-editions/subtitle-replacement/facet.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { createSystemHttpServer } from "#testing/system/http.ts";
import { SystemHttpBrowser } from "#testing/system/browser.ts";
import { createPublishedMovieFixture } from "#testing/movie-workflow/upgrade-fixture.ts";
import {
  authenticateMovieHistoryHttp,
  movieHistoryHttpIdentity,
} from "#testing/movie-workflow/history/history-http-transport.ts";

/** Actual served video and installation ancestry; all replacement admission goes through the production HTTP composition. */
export async function createMovieReplacementHttpFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  prepareHttp?: (
    http: ReturnType<typeof createSystemHttpServer>,
  ) => Promise<void>,
) {
  const original = await createPublishedMovieFixture(edition, bytes);
  const { db, context, files } = original.source;
  const identity = movieHistoryHttpIdentity(context);
  let http: ReturnType<typeof createSystemHttpServer> | undefined;
  const close = async () => {
    try {
      await http?.close();
      await identity.close();
    } finally {
      await original.close();
    }
  };
  try {
    const owner = await db.mediaUser.findFirstOrThrow({
      where: { role: "owner", restricted: false },
    });
    const member = original.source.user;
    const starts: WorkflowStart[] = [];
    http = createSystemHttpServer({
      db,
      cipher: context.cipher,
      plex: identity.plex,
      plexTransport: () =>
        Promise.reject(
          new Error(
            "Caption HTTP admission cannot invent a Plex profile administration response",
          ),
        ),
      plexUrl: identity.origin,
      serverMachineId: z.string().min(1).parse(context.serverMachineId),
      ownerAccountId: owner.plexAccountId,
      tmdb: context.tmdb,
      startWorkflow: (input) => {
        starts.push(input);
        return Promise.resolve();
      },
      describeWorkflow: () =>
        Promise.reject(
          new Error(
            "Caption HTTP acceptance cannot invent a Temporal terminal execution",
          ),
        ),
    });
    await prepareHttp?.(http);
    const login = async (
      role: "owner" | "member",
      browser: SystemHttpBrowser,
    ) => {
      const actor = role === "owner" ? owner : member;
      identity.select(actor);
      const authenticated = await authenticateMovieHistoryHttp(browser);
      if (authenticated.id !== actor.id)
        throw new Error("Actual caption PIN selected another person");
      return authenticated;
    };
    const ownerBrowser = new SystemHttpBrowser(http.origin);
    const memberBrowser = new SystemHttpBrowser(http.origin);
    await login("owner", ownerBrowser);
    await login("member", memberBrowser);
    identity.select(owner);
    const old = await db.subtitleAsset.findFirstOrThrow({
      where: {
        assetId: original.asset.id,
        state: "installed",
        storageKind: "sidecar",
        language: "en",
      },
    });
    const sibling = await db.subtitleAsset.findFirstOrThrow({
      where: {
        assetId: original.asset.id,
        state: "installed",
        storageKind: "sidecar",
        language: "zh-Hans",
      },
    });
    const baseline = async () => ({
      asset: await db.libraryAsset.findUniqueOrThrow({
        where: { id: original.asset.id },
      }),
      pointer: await db.plexBindingCurrent.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: original.scope.mediaId, edition },
        },
      }),
      sourceCommands: await db.operation.findMany({
        where: {
          OR: [
            { id: original.input.operationId },
            {
              kind: "acquire_movie_subtitles_v4",
              payload: { path: ["assetId"], equals: original.asset.id },
            },
          ],
        },
        orderBy: { id: "asc" },
      }),
      publications: await db.mediaPublicationTransition.findMany({
        where: { attempt: { operationId: original.input.operationId } },
        orderBy: { id: "asc" },
      }),
      sibling: await db.subtitleAsset.findUniqueOrThrow({
        where: { id: sibling.id },
      }),
      choices: await db.movieEditionChoice.findMany({
        where: { rootMediaId: original.scope.mediaId },
        orderBy: { id: "asc" },
      }),
      adds: original.source.wire.additions(),
      deletes: original.source.wire.control.deletes,
    });
    const physical = async () => ({
      video: await digest(workerFilePath(files.context, original.asset.path)),
      english: await digest(
        workerFilePath(files.context, z.string().parse(old.path)),
      ),
      chinese: await digest(
        workerFilePath(files.context, z.string().parse(sibling.path)),
      ),
    });
    const fileFacet = createMovieSubtitleReplacementFileFacet(files.context);
    const invoke = (
      phase: Parameters<typeof fileFacet>[0],
      input: SubtitleReplacementInput,
    ) =>
      fileFacet(phase, input, {
        execution: testPublicationExecution(),
        budget: new PublicationAuthorityReadBudget(),
      });
    return {
      db,
      http,
      scope: original.scope,
      title: original.source.media.title,
      ownerBrowser,
      memberBrowser,
      login,
      selectAccount: (role: "owner" | "member") => {
        identity.select(role === "owner" ? owner : member);
      },
      old,
      sibling,
      baseline,
      physical,
      invoke,
      starts,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function digest(path: string) {
  const bytes = await readFile(path);
  return {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
