import { afterEach, beforeEach, expect, test } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { vi } from "vitest";
import {
  pollPlexLogin,
  queryClient,
  readSession,
  sessionBoundary,
  logout,
} from "./api.ts";
import { SessionChangedError } from "./session.ts";
import {
  denied,
  captureFailure,
  loadOwner,
  member,
  owner,
  ownerReview,
  privateTitle,
  recoveryKey,
  recoveryQuery,
  renderSession,
  reviewId,
  sessionFixture,
  sessionQuery,
} from "./session.test-support.tsx";

beforeEach(() => {
  sessionBoundary.publish(
    null,
    sessionBoundary.getSnapshot().generation,
    "logout",
  );
  queryClient.clear();
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

test("owner expiry retires private cache before Login and before a member's denied refetch", async () => {
  const f = sessionFixture();
  await loadOwner();
  expect(renderSession()).toContain(privateTitle);
  const previous = sessionBoundary.getSnapshot().generation;
  f.routes.set("/api/v1/me", () => denied(401));
  await queryClient.query(sessionQuery);
  expect(renderSession()).toContain("Sign in with Plex");
  expect(queryClient.getQueryData(recoveryKey)).toBeUndefined();
  await pollPlexLogin("synthetic");
  expect(sessionBoundary.getSnapshot().generation).toBeGreaterThan(previous);
  expect(renderSession()).toContain("Synthetic Member");
  expect(renderSession()).not.toContain(privateTitle);
  const deniedResponse = Promise.withResolvers<Response>();
  f.routes.set(
    `/api/v1/recovery/reviews/${reviewId}`,
    () => deniedResponse.promise,
  );
  const observer = new QueryObserver(queryClient, {
    ...recoveryQuery,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(vi.fn());
  try {
    const pending = observer.refetch();
    expect(observer.getCurrentResult().fetchStatus).toBe("fetching");
    expect(renderSession()).not.toContain(privateTitle);
    deniedResponse.resolve(denied());
    await pending;
    expect(observer.getCurrentResult().error).toMatchObject({ status: 403 });
    expect(queryClient.getQueryState(recoveryKey)).toMatchObject({
      status: "error",
      data: undefined,
    });
    expect(renderSession()).not.toContain(privateTitle);
  } finally {
    unsubscribe();
    observer.destroy();
  }
});

test.each([
  ["principal", member],
  ["permission version", { ...owner, version: 2 }],
  ["role", { ...owner, role: "member" }],
  ["restriction", { ...owner, restricted: true }],
  ["Plex identity", { ...owner, plexAccountId: "another-identity" }],
])(
  "refreshed /me changes %s and clears private state before the new Shell",
  async (_label, user) => {
    const f = sessionFixture();
    await loadOwner();
    const generation = sessionBoundary.getSnapshot().generation;
    f.routes.set("/api/v1/me", () => Response.json(user));
    const observer = new QueryObserver(queryClient, {
      ...sessionQuery,
      enabled: false,
    });
    const unsubscribe = observer.subscribe(vi.fn());
    try {
      await observer.refetch();
      expect(sessionBoundary.getSnapshot().generation).toBe(generation + 1);
      expect(queryClient.getQueryData(recoveryKey)).toBeUndefined();
      expect(renderSession()).not.toContain(privateTitle);
      expect(renderSession()).toContain("Review protected titles");
    } finally {
      unsubscribe();
      observer.destroy();
    }
  },
);

test("an unchanged /me refresh preserves the current account cache", async () => {
  sessionFixture();
  await loadOwner();
  const generation = sessionBoundary.getSnapshot().generation;
  await queryClient.query(sessionQuery);
  expect(sessionBoundary.getSnapshot().generation).toBe(generation);
  expect(renderSession()).toContain(privateTitle);
});

test("private cache removal precedes publication of the next principal", async () => {
  sessionFixture();
  await loadOwner();
  const duringRemoval: (string | undefined)[] = [];
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed" && event.query.queryKey[0] === "recovery")
      duringRemoval.push(sessionBoundary.getSnapshot().user?.id);
  });
  try {
    await pollPlexLogin("synthetic");
    expect(duringRemoval).toEqual([owner.id]);
    expect(sessionBoundary.getSnapshot().user?.id).toBe(member.id);
    expect(queryClient.getQueryData(recoveryKey)).toBeUndefined();
  } finally {
    unsubscribe();
  }
});

test("a cancelled old read cannot overwrite a new account's result even if transport ignores abort", async () => {
  const f = sessionFixture();
  await loadOwner();
  const response = Promise.withResolvers<Response>();
  f.routes.set(`/api/v1/recovery/reviews/${reviewId}`, () => response.promise);
  const settled = Promise.withResolvers<undefined>();
  const pending = captureFailure(
    queryClient.query({
      ...recoveryQuery,
      queryFn: async () => {
        try {
          return await recoveryQuery.queryFn();
        } finally {
          settled.resolve(undefined);
        }
      },
    }),
  );
  await pollPlexLogin("synthetic");
  const currentReview = {
    ...ownerReview,
    scope: { ...ownerReview.scope, media: [] },
  };
  f.routes.set(`/api/v1/recovery/reviews/${reviewId}`, () =>
    Response.json(currentReview),
  );
  await queryClient.query(recoveryQuery);
  response.resolve(Response.json(ownerReview));
  await pending;
  await settled.promise;
  expect(queryClient.getQueryData(recoveryKey)).toEqual(currentReview);
  expect(renderSession()).not.toContain(privateTitle);
  expect(f.calls.some(({ input }) => input?.signal?.aborted === true)).toBe(
    true,
  );
});

test.each([200, 401])(
  "delayed old /me %s and login replies cannot republish a retired principal",
  async (status) => {
    const f = sessionFixture();
    await loadOwner();
    const response = Promise.withResolvers<Response>();
    f.routes.set("/api/v1/me", () => response.promise);
    const oldRefresh = captureFailure(readSession());
    await pollPlexLogin("synthetic");
    response.resolve(status === 200 ? Response.json(owner) : denied(401));
    expect(await oldRefresh).toBeInstanceOf(SessionChangedError);
    expect(renderSession()).toContain("Synthetic Member");
    const loginResponse = Promise.withResolvers<Response>();
    f.routes.set(
      "/api/v1/auth/plex/poll/synthetic",
      () => loginResponse.promise,
    );
    const oldLogin = captureFailure(pollPlexLogin("synthetic"));
    f.routes.set("/api/v1/me", () => Response.json({ ...member, version: 2 }));
    await queryClient.query(sessionQuery);
    loginResponse.resolve(
      Response.json({
        status: "authenticated",
        user: owner,
        csrfToken: "synthetic-only",
      }),
    );
    expect(await oldLogin).toBeInstanceOf(SessionChangedError);
    expect(sessionBoundary.getSnapshot().user).toMatchObject({
      id: member.id,
      version: 2,
    });
    expect(renderSession()).not.toContain(privateTitle);
  },
);

test("fresh member and successful logout do not inherit an owner's private cache", async () => {
  const f = sessionFixture();
  f.routes.set("/api/v1/me", () => Response.json(member));
  await queryClient.query(sessionQuery);
  expect(renderSession()).not.toContain(privateTitle);
  f.routes.set("/api/v1/me", () => Response.json(owner));
  await loadOwner();
  await logout();
  expect(renderSession()).toContain("Sign in with Plex");
  expect(queryClient.getQueryData(recoveryKey)).toBeUndefined();
  await pollPlexLogin("synthetic");
  expect(renderSession()).toContain("Synthetic Member");
  expect(renderSession()).not.toContain(privateTitle);
});

test("login isolates an attached pending /me refresh from the newly published session query", async () => {
  const f = sessionFixture();
  await loadOwner();
  const response = Promise.withResolvers<Response>();
  f.routes.set("/api/v1/me", () => response.promise);
  const observer = new QueryObserver(queryClient, {
    ...sessionQuery,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(vi.fn());
  const previous = queryClient
    .getQueryCache()
    .find({ queryKey: ["me"], exact: true });
  try {
    const pending = observer.refetch();
    expect(observer.getCurrentResult().fetchStatus).toBe("fetching");
    await pollPlexLogin("synthetic");
    await pending;
    response.resolve(Response.json(owner));
    expect(
      queryClient.getQueryCache().find({ queryKey: ["me"], exact: true }),
    ).not.toBe(previous);
    expect(queryClient.getQueryState(["me"])).toMatchObject({
      status: "success",
      error: null,
      data: member,
    });
    expect(renderSession()).toContain("Synthetic Member");
    expect(renderSession()).not.toContain("Try again");
    expect(renderSession()).not.toContain(privateTitle);
  } finally {
    unsubscribe();
    observer.destroy();
  }
});
