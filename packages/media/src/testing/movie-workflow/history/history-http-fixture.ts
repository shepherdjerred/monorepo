import { z } from "zod";
import type { WorkflowStarter } from "#automation/store.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import {
  MovieEditionContextV3Schema,
  type MovieEditionContextV3,
} from "#shared/movie-editions/view.ts";
import {
  MovieRequestResultV3Schema,
  MovieRequestV3Schema,
} from "#shared/movie-editions/commands.ts";
import {
  MovieHistoryCommandResultV3Schema,
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
  PrepareMovieHistoryV3Schema,
  MovieHistoryDeclarationV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { createSystemHttpServer } from "#testing/system/http.ts";
import { SystemHttpBrowser } from "#testing/system/browser.ts";
import { createMovieHistoryFixture } from "./history-review-fixture.ts";
import {
  movieHistoryHttpIdentity,
  authenticateMovieHistoryHttp,
  movieHistoryHttpResponse as read,
} from "./history-http-transport.ts";

/** Real HTTP/CSRF/PIN and explicit per-person consent precede the immutable review and release command. */
export async function createMovieHistoryHttpFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  options: {
    actualMovieExclusion?: boolean;
    canonicalStorage?: boolean;
    startWorkflow?: WorkflowStarter;
  } = {},
) {
  const f = await createMovieHistoryFixture(edition, bytes, options);
  const baseline = {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.original.asset.id },
    }),
    handoff: await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.original.receiptId },
    }),
    binding: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    }),
  };
  const identity = movieHistoryHttpIdentity(f.original.context);
  const http = createSystemHttpServer({
    db: f.db,
    cipher: f.original.context.cipher,
    plex: identity.plex,
    plexTransport: () =>
      Promise.reject(
        new Error(
          "Self declarations cannot invent a Plex profile administration response",
        ),
      ),
    plexUrl: identity.origin,
    serverMachineId: f.settings.serverMachineId,
    ownerAccountId: f.owner.plexAccountId,
    tmdb: f.original.context.tmdb,
    startWorkflow:
      options.startWorkflow ??
      (() =>
        Promise.reject(
          new Error("Native HTTP fixture has no Temporal workflow worker"),
        )),
    describeWorkflow: () =>
      Promise.reject(
        new Error("History review never manufactures a prior workflow status"),
      ),
  });
  const close = async () => {
    try {
      await http.close();
      await identity.close();
    } finally {
      await f.close();
    }
  };
  try {
    const browsers = new Map<string, SystemHttpBrowser>();
    for (const person of f.household) {
      identity.select(person);
      const browser = new SystemHttpBrowser(http.origin);
      const authenticated = await authenticateMovieHistoryHttp(browser);
      if (authenticated.id !== person.id)
        throw new Error("Real PIN resolved another household subject");
      browsers.set(person.id, browser);
    }
    const owner = browsers.get(f.owner.id);
    const member = f.household.find((person) => person.id !== f.owner.id);
    const personal = member === undefined ? undefined : browsers.get(member.id);
    if (owner === undefined || member === undefined || personal === undefined)
      throw new Error(
        "Actual initial library household lacks both authenticated people",
      );
    const choiceContext = await read(
      await personal.request(
        `/api/v3/media/${f.scope.mediaId}/movie-edition-context`,
      ),
      MovieEditionContextV3Schema,
    );
    const chosen = await read(
      await personal.request(
        `/api/v3/media/${f.scope.mediaId}/movie-requests`,
        {
          key: crypto.randomUUID(),
          body: personalMovieRequest(choiceContext, edition),
        },
      ),
      MovieRequestResultV3Schema,
    );
    const request = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: chosen.requestId },
    });
    const choice = await f.db.movieEditionChoice.findUniqueOrThrow({
      where: { id: chosen.choiceId },
    });
    const scopeQuery = `mediaId=${f.scope.mediaId}&edition=${edition}`;
    const prepare = await read(
      await owner.request(`/api/v3/movie-history/context?${scopeQuery}`),
      PrepareMovieHistoryV3Schema,
    );
    const captured = await read(
      await owner.request("/api/v3/movie-history/reviews", {
        key: crypto.randomUUID(),
        body: prepare,
      }),
      MovieHistoryCommandResultV3Schema,
    );
    const detail = await read(
      await owner.request(
        `/api/v3/movie-history/reviews/${captured.recoveryReviewId}`,
      ),
      MovieHistoryDetailV3Schema,
    );
    const pending = await read(
      await personal.request("/api/v3/movie-history/reviews"),
      MovieHistoryPendingV3Schema,
    );
    if (!pending.reviews.some((row) => row.id === detail.id))
      throw new Error(
        "Current-person discovery omitted their real pending declaration",
      );
    const visible = await read(
      await personal.request(`/api/v3/movie-history/reviews/${detail.id}`),
      MovieHistoryPersonalDetailV3Schema,
    );
    for (const subject of detail.scope.users) {
      const browser = browsers.get(subject.id);
      if (browser === undefined)
        throw new Error(
          "Cannot declare another applicable person's household intent",
        );
      const declaration = MovieHistoryDeclarationV3Schema.parse(
        subject.id === member.id
          ? {
              intent: "request",
              currentChoice: {
                requestId: request.id,
                requestVersion: request.version,
                choiceId: choice.id,
                choiceRevision: choice.choiceRevision,
                subtitleLanguages: request.subtitleLanguages,
              },
            }
          : { intent: "no_longer_request" },
      );
      await read(
        await browser.request(
          `/api/v3/movie-history/reviews/${detail.id}/responses`,
          {
            key: crypto.randomUUID(),
            body: {
              schemaVersion: 3,
              scope: f.scope,
              scopeHash: detail.scopeHash,
              subjectUserId: subject.id,
              definition: detail.scope.definition,
              registryVersion: 1,
              declaration,
              claimAcknowledgements: subject.claimAcknowledgements,
              acknowledgeMissingHistory: true,
            },
          },
        ),
        MovieHistoryCommandResultV3Schema,
      );
    }
    const ready = await read(
      await owner.request(`/api/v3/movie-history/reviews/${detail.id}`),
      MovieHistoryDetailV3Schema,
    );
    const releaseInput = {
      schemaVersion: 3,
      scope: f.scope,
      expectedVersion: ready.version,
      scopeHash: ready.scopeHash,
      responseHash: ready.responseHash,
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    };
    const key = crypto.randomUUID();
    const released = await read(
      await owner.request(
        `/api/v3/movie-history/reviews/${detail.id}/release`,
        { key, body: releaseInput },
      ),
      MovieHistoryCommandResultV3Schema,
    );
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(released.operationId) },
    });
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(operation.payload),
    );
    return {
      ...f,
      baseline,
      http,
      ownerBrowser: owner,
      memberBrowser: personal,
      member,
      chosen,
      request,
      choice,
      detail,
      visible,
      pending,
      released,
      input,
      releaseInput,
      key,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The real HTTP contract is sufficient here; importing browser API modules would pull DOM into workers. */
function personalMovieRequest(
  context: MovieEditionContextV3,
  edition: MovieEditionKey,
) {
  const selected = context.options.find((option) => option.edition === edition);
  if (selected === undefined)
    throw new Error("Actual current edition context omitted the selected cut");
  return MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: context.mediaId,
    subjectUserId: context.subjectUserId,
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
      edition,
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: [] },
  });
}
