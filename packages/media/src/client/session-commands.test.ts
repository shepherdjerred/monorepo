import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { z } from "zod";
import {
  commandKey,
  logout,
  pollPlexLogin,
  queryClient,
  sessionBoundary,
  writeApi,
} from "./api.ts";
import { SessionChangedError } from "./session.ts";
import {
  captureFailure,
  loadOwner,
  owner,
  sessionFixture,
} from "./session.test-support.tsx";

const command = {
  actorId: owner.id,
  path: "/requests",
  body: { mediaId: "synthetic-film" },
  schema: z.object({ status: z.literal("queued") }),
};

beforeEach(() => {
  sessionBoundary.publish(
    null,
    sessionBoundary.getSnapshot().generation,
    "logout",
  );
  queryClient.clear();
});
afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
  vi.unstubAllGlobals();
});

test("a sent old mutation cannot notify the member or consume its unknown-sent command key", async () => {
  const f = sessionFixture();
  await loadOwner();
  const response = Promise.withResolvers<Response>();
  f.routes.set("/api/v1/requests", () => response.promise);
  const success = vi.fn();
  const error = vi.fn();
  const observer = new MutationObserver(queryClient, {
    mutationFn: () => writeApi(command),
    onSuccess: success,
    onError: error,
  });
  const unsubscribe = observer.subscribe(vi.fn());
  try {
    const pending = captureFailure(observer.mutate(undefined));
    await vi.waitFor(() =>
      expect(
        f.calls.filter(({ url }) => url === "/api/v1/requests"),
      ).toHaveLength(1),
    );
    const originalKey = await commandKey(
      f.storage,
      command.actorId,
      command.path,
      command.body,
    );
    await pollPlexLogin("synthetic");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    response.resolve(Response.json({ status: "queued" }));
    expect(await pending).toBeInstanceOf(SessionChangedError);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(
      await commandKey(f.storage, command.actorId, command.path, command.body),
    ).toEqual(originalKey);
    await expect(writeApi(command)).rejects.toBeInstanceOf(SessionChangedError);
    expect(
      f.calls.filter(({ url }) => url === "/api/v1/requests"),
    ).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});

test("a retired paused mutation cannot send when connectivity returns", async () => {
  const f = sessionFixture();
  await loadOwner();
  onlineManager.setOnline(false);
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: () => writeApi(command),
  });
  const pending = captureFailure(mutation.execute(undefined));
  await vi.waitFor(() => expect(mutation.state.isPaused).toBe(true));
  await pollPlexLogin("synthetic");
  onlineManager.setOnline(true);
  await expect(mutation.continue()).rejects.toBeInstanceOf(SessionChangedError);
  expect(await pending).toBeInstanceOf(SessionChangedError);
  expect(f.calls.filter(({ url }) => url === "/api/v1/requests")).toHaveLength(
    0,
  );
});

test("logout retains actor-bound pending command identities without replaying them", async () => {
  const f = sessionFixture();
  await loadOwner();
  const pending = await commandKey(
    f.storage,
    command.actorId,
    command.path,
    command.body,
  );
  await logout();
  expect(f.storage.getItem(pending.storageKey)).toBe(pending.key);
  expect(f.calls.filter(({ url }) => url === "/api/v1/requests")).toHaveLength(
    0,
  );
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
});
