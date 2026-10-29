import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { QueryClient } from "@tanstack/react-query";
import { CredentialCipher } from "#application/security.ts";
import { type WorkflowStart } from "#automation/store.ts";
import {
  CommandResultSchema,
  CatalogSearchSchema,
  MediaDetailSchema,
} from "#shared/api.ts";
import { UserSchema } from "#shared/contract.ts";
import {
  MovieEditionContextV3Schema,
  MovieEditionRequestListV3Schema,
} from "#shared/movie-editions/view.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { MovieRequestResultV3Schema } from "#shared/movie-editions/commands.ts";
import { movieRequest } from "#client/movie-editions/api.ts";
import { SessionBoundary } from "#client/session.ts";
import { grantTestLease } from "#testing/authority.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createSystemHttpServer } from "./http.ts";
import { SystemHttpBrowser } from "./browser.ts";
import { SYSTEM_MOVIE, systemExternalServices } from "./external.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>> | undefined;
let external: ReturnType<typeof systemExternalServices> | undefined;
let http: ReturnType<typeof createSystemHttpServer> | undefined;
const starts: WorkflowStart[] = [];
const profileInput = {
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
};

beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  external = systemExternalServices();
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  await grantTestLease(db);
  http = createSystemHttpServer({
    ...external,
    db,
    cipher: new CredentialCipher(randomBytes(32).toString("base64")),
    plexTransport: external.transport,
    startWorkflow: (input) => {
      starts.push(input);
      return Promise.resolve();
    },
    describeWorkflow: () => Promise.resolve(null),
  });
}, 60_000);

afterAll(async () => {
  await http?.close();
  await external?.close();
  await cluster?.close();
});

async function login(browser: SystemHttpBrowser) {
  const started = await browser.request("/api/v1/auth/plex/start", {
    method: "POST",
  });
  expect(started.status).toBe(201);
  const pin = z
    .object({ id: z.uuid(), authorizationUrl: z.url() })
    .parse(await started.json());
  const authorization = await fetch(pin.authorizationUrl);
  expect(authorization.status).toBe(200);
  const resolved = await browser.request(`/api/v1/auth/plex/poll/${pin.id}`, {
    method: "POST",
  });
  expect(resolved.status).toBe(200);
  const result = z
    .object({ status: z.literal("authenticated"), user: UserSchema })
    .parse(await resolved.json());
  const current = await browser.request("/api/v1/me");
  expect(current.status).toBe(200);
  expect(UserSchema.parse(await current.json())).toEqual(result.user);
  return result.user;
}

test("a signed-in movie request reaches real PostgreSQL and the outbox through HTTP, with exact command replay", async () => {
  if (http === undefined || cluster === undefined || external === undefined)
    throw new Error("System HTTP sandbox missing");
  external.selectAccount("1001");
  const browser = new SystemHttpBrowser(http.origin);
  const owner = await login(browser);
  expect(owner.role).toBe("owner");
  const search = await browser.request(
    `/api/v1/catalog/search?q=${encodeURIComponent(SYSTEM_MOVIE.title)}`,
  );
  expect(search.status).toBe(200);
  expect(CatalogSearchSchema.parse(await search.json()).results).toMatchObject([
    { externalId: SYSTEM_MOVIE.id },
  ]);
  const profile = await browser.request("/api/v1/admin/profiles", {
    key: crypto.randomUUID(),
    body: profileInput,
  });
  expect(profile.status).toBe(202);
  const { profileId } = CommandResultSchema.parse(await profile.json());
  expect(z.uuid().safeParse(profileId).success).toBe(true);
  const defaults = await browser.request(
    "/api/v1/admin/profile-defaults/movie",
    {
      method: "PUT",
      key: crypto.randomUUID(),
      body: { expectedVersion: 0, profileId },
    },
  );
  expect(defaults.status).toBe(200);
  const adopted = await browser.request("/api/v1/catalog/adopt", {
    key: crypto.randomUUID(),
    body: { kind: "movie", externalId: SYSTEM_MOVIE.id },
  });
  expect(adopted.status).toBe(201);
  const { mediaId } = z
    .object({ mediaId: z.uuid() })
    .parse(await adopted.json());
  const choices = await browser.request(
    `/api/v3/media/${mediaId}/movie-edition-context`,
  );
  expect(choices.status).toBe(200);
  const context = MovieEditionContextV3Schema.parse(await choices.json());
  expect(context.subjectUserId).toBe(owner.id);
  const input = movieRequest(context, "default", "en");
  const key = crypto.randomUUID();
  const path = `/api/v3/media/${mediaId}/movie-requests`;
  const response = await browser.request(path, { key, body: input });
  expect(response.status).toBe(200);
  const result = MovieRequestResultV3Schema.parse(await response.json());
  expect(result).toMatchObject({
    state: "queued",
    edition: "default",
    reason: null,
  });
  const operationId = z.uuid().parse(result.operationId);
  const db = cluster.database;
  expect(
    await db.mediaRequest.findUniqueOrThrow({
      where: { id: result.requestId },
    }),
  ).toMatchObject({
    userId: owner.id,
    mediaId,
    active: true,
    movieEditionChoiceId: result.choiceId,
    subtitleLanguages: ["en"],
  });
  const replay = await browser.request(path, { key, body: input });
  expect(replay.status).toBe(200);
  expect(MovieRequestResultV3Schema.parse(await replay.json())).toEqual(result);
  expect(await db.operation.count({ where: { id: operationId } })).toBe(1);
  expect(await db.outboxCommand.count({ where: { operationId } })).toBe(1);
  await expect
    .poll(() =>
      db.outboxCommand.count({
        where: { operationId, dispatchedAt: { not: null } },
      }),
    )
    .toBe(1);
  expect(
    starts.filter((start) => start.input["operationId"] === operationId),
  ).toContainEqual({
    workflowType: "reconcileMediaWorkflow",
    workflowId: `media-operation-${operationId}`,
    input: expect.objectContaining({
      operationId,
      mediaId,
      kind: "reconcile_media",
    }),
  });
  // The mounted movie page loads these views independently. Authentication
  // refreshes access for each request while the views acquire snapshot locks.
  const views = [
    [`/api/v1/media/${mediaId}`, MediaDetailSchema],
    [`/api/v2/media/${mediaId}/targets/default`, DefaultTargetViewSchema],
    [
      `/api/v3/media/${mediaId}/movie-edition-context`,
      MovieEditionContextV3Schema,
    ],
    ["/api/v3/movie-requests", MovieEditionRequestListV3Schema],
  ] as const;
  await Promise.all(
    views.map(async ([viewPath, schema]) => {
      const view = await browser.request(viewPath);
      expect(view.status, viewPath).toBe(200);
      schema.parse(await view.json());
    }),
  );
  expect(http.errors).toEqual([]);
});

type SystemPermissions = Parameters<
  ReturnType<typeof systemExternalServices>["setPermissions"]
>[0];
const permissionChanges: { label: string; permissions: SystemPermissions }[] = [
  {
    label: "library sections",
    permissions: {
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie", "series"],
      plexRestricted: false,
    },
  },
  {
    label: "media kinds",
    permissions: {
      permittedSectionIds: ["1", "2"],
      permittedMediaKinds: ["movie"],
      plexRestricted: false,
    },
  },
  {
    label: "Plex restriction",
    permissions: {
      permittedSectionIds: ["1", "2"],
      permittedMediaKinds: ["movie", "series"],
      plexRestricted: true,
    },
  },
];

test.each(permissionChanges)(
  "the first /me after a $label change retires old private cache, including concurrent refreshes",
  async ({ permissions }) => {
    if (http === undefined || cluster === undefined || external === undefined)
      throw new Error("System HTTP sandbox missing");
    external.selectAccount("1002");
    external.setPermissions({
      permittedSectionIds: ["1", "2"],
      permittedMediaKinds: ["movie", "series"],
      plexRestricted: false,
    });
    const browser = new SystemHttpBrowser(http.origin);
    const original = await login(browser);
    const db = cluster.database;
    const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: original.id },
    });
    const cache = new QueryClient();
    const boundary = new SessionBoundary(cache);
    boundary.publish(original, boundary.getSnapshot().generation, "login");
    cache.setQueryData(["private-detail"], {
      title: "Synthetic prior-scope title",
    });
    const generation = boundary.getSnapshot().generation;
    external.setPermissions(permissions);
    try {
      const responses = await Promise.all([
        browser.request("/api/v1/me"),
        browser.request("/api/v1/me"),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        const user = UserSchema.parse(await response.json());
        expect(user.version).toBe(original.version + 1);
        boundary.publish(user, boundary.getSnapshot().generation, "refresh");
      }
      expect(boundary.getSnapshot().generation).toBe(generation + 1);
      expect(cache.getQueryData(["private-detail"])).toBeUndefined();
      const unchanged = await browser.request("/api/v1/me");
      expect(UserSchema.parse(await unchanged.json()).version).toBe(
        original.version + 1,
      );
      expect(
        await db.plexIdentityMapping.findUniqueOrThrow({
          where: { userId: original.id },
        }),
      ).toMatchObject({ version: mapping.version + 1 });
      expect(
        await db.mediaUser.findUniqueOrThrow({ where: { id: original.id } }),
      ).toMatchObject({ version: original.version + 1 });
    } finally {
      cache.clear();
    }
  },
);

test("a separate member browser authenticates normally and cannot invoke owner profile administration", async () => {
  if (http === undefined || cluster === undefined || external === undefined)
    throw new Error("System HTTP sandbox missing");
  external.selectAccount("1002");
  const browser = new SystemHttpBrowser(http.origin);
  const anonymous = await browser.request("/api/v1/admin/users");
  expect(anonymous.status).toBe(401);
  const member = await login(browser);
  expect(member.role).toBe("member");
  const before = await cluster.database.qualityProfile.count();
  const users = await browser.request("/api/v1/admin/users");
  expect(users.status).toBe(403);
  const forbidden = await browser.request("/api/v1/admin/profiles", {
    key: crypto.randomUUID(),
    body: { ...profileInput, name: "Member must not create this profile" },
  });
  expect(forbidden.status).toBe(403);
  expect(await cluster.database.qualityProfile.count()).toBe(before);
  const logout = await browser.request("/api/v1/auth/logout", {
    method: "POST",
  });
  expect(logout.status).toBe(204);
  const loggedOut = await browser.request("/api/v1/me");
  expect(loggedOut.status).toBe(401);
  expect(http.errors).toEqual([]);
});
