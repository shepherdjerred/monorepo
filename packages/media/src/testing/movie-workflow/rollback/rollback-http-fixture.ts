import { z } from "zod";
import { createMovieRollbackFixture } from "./rollback-fixture.ts";
import { installMovieFixtureCaptions } from "#testing/movie-workflow/upgrade-fixture.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createSystemHttpServer } from "#testing/system/http.ts";
import { SystemHttpBrowser } from "#testing/system/browser.ts";
import {
  authenticateMovieHistoryHttp,
  movieHistoryHttpIdentity,
} from "#testing/movie-workflow/history/history-http-transport.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { WorkflowStart } from "#automation/store.ts";

/** Actual served A/B, original archive window and independent owner. Only external PIN and Workflow start are synthetic. */
export async function createMovieRollbackHttpFixture(
  edition: MovieEditionKey,
  videos: { original: Uint8Array; upgrade: Uint8Array },
  prepareHttp?: (
    http: ReturnType<typeof createSystemHttpServer>,
  ) => Promise<void>,
) {
  const f = await createMovieRollbackFixture(edition, videos);
  let http: ReturnType<typeof createSystemHttpServer> | undefined;
  const identity = movieHistoryHttpIdentity(f.context);
  const close = async () => {
    try {
      await http?.close();
      await identity.close();
    } finally {
      await f.close();
    }
  };
  try {
    const execution = testPlexBindingExecution();
    const published = await f.movie.publishMovieToPlexV4(f.input, execution);
    if (published.status !== "available")
      throw new Error("Actual rollback HTTP source did not reach Plex");
    await f.movie.finalizeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    );
    await installMovieFixtureCaptions(
      f.db,
      f.plan.entries[0].assetId,
      f.movie,
      f.fileMovie,
    );
    const account = await f.db.mediaUser.findFirstOrThrow({
      where: { role: "owner", restricted: false },
    });
    const owner = await authenticateMovieFixtureOwner(f.context, account);
    const member = f.network.actor;
    const starts: WorkflowStart[] = [];
    http = createSystemHttpServer({
      db: f.db,
      cipher: f.context.cipher,
      plex: identity.plex,
      plexTransport: () =>
        Promise.reject(
          new Error(
            "Rollback HTTP fixture cannot invent managed profile administration",
          ),
        ),
      plexUrl: identity.origin,
      serverMachineId: z.string().parse(f.context.serverMachineId),
      ownerAccountId: owner.plexAccountId,
      tmdb: f.context.tmdb,
      startWorkflow: (input) => {
        starts.push(input);
        return Promise.resolve();
      },
      describeWorkflow: () =>
        Promise.reject(
          new Error(
            "Rollback HTTP fixture cannot invent a prior executor status",
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
        throw new Error("Actual rollback HTTP PIN selected another person");
    };
    const ownerBrowser = new SystemHttpBrowser(http.origin);
    const memberBrowser = new SystemHttpBrowser(http.origin);
    await login("owner", ownerBrowser);
    await login("member", memberBrowser);
    identity.select(owner);
    return {
      ...f,
      http,
      owner,
      member,
      ownerBrowser,
      memberBrowser,
      starts,
      login,
      selectAccount: (role: "owner" | "member") => {
        identity.select(role === "owner" ? owner : member);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
