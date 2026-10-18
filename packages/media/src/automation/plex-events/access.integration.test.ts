import { describe, expect, test } from "vitest";
import { observeRequesterWatch } from "#automation/watch.ts";
import {
  watchHarness,
  watchedTransport,
  pausedTransport,
} from "./test-support.ts";

describe("scoped watch permission proof", () => {
  const h = watchHarness();
  test.each(["permitted", "wrong_machine", "revoked_section"])(
    "aged mapping uses current scoped access: %s",
    async (kind) => {
      const f = await h.fixture();
      const verifiedAt = new Date(Date.now() - 360_000);
      await h.database().plexIdentityMapping.update({
        where: { userId: f.user.id },
        data: { verifiedAt },
      });
      const calls: string[] = [];
      const result = await observeRequesterWatch(
        h.context(async (url, init) => {
          calls.push(url.pathname);
          expect(new Headers(init.headers).get("X-Plex-Token")).toBe(f.user.id);
          if (url.pathname === "/identity")
            return Response.json({
              MediaContainer: {
                machineIdentifier:
                  kind === "wrong_machine" ? "other" : "fixture-server",
              },
            });
          if (url.pathname === "/library/sections")
            return Response.json({
              MediaContainer: {
                size: kind === "revoked_section" ? 0 : 1,
                Directory:
                  kind === "revoked_section"
                    ? []
                    : [{ key: "1", title: "Movies", type: "movie" }],
              },
            });
          return await watchedTransport(true)(url, init);
        }),
        f.media.id,
      );
      expect(result.complete).toBe(kind === "permitted");
      expect(calls[0]).toBe("/identity");
      expect(
        await h
          .database()
          .plexIdentityMapping.findUnique({ where: { userId: f.user.id } }),
      ).toMatchObject({ verifiedAt, version: 0 });
      expect(
        await h.database().watchState.count({ where: { mediaId: f.media.id } }),
      ).toBe(kind === "permitted" ? 1 : 0);
    },
  );
  test.each(["null", "future", "wrong_server", "wrong_scope"])(
    "%s mapping cannot be rescued by an owner token",
    async (kind) => {
      const f = await h.fixture();
      await h.database().plexIdentityMapping.update({
        where: { userId: f.user.id },
        data: {
          ...(kind === "null" ? { verifiedAt: null } : {}),
          ...(kind === "future"
            ? { verifiedAt: new Date(Date.now() + 60_000) }
            : {}),
          ...(kind === "wrong_server" ? { serverMachineId: "other" } : {}),
          ...(kind === "wrong_scope" ? { permittedSectionIds: ["2"] } : {}),
        },
      });
      expect(
        await observeRequesterWatch(h.context(), f.media.id),
      ).toMatchObject({ complete: false });
      expect(
        await h.database().watchState.count({ where: { mediaId: f.media.id } }),
      ).toBe(0);
    },
  );
  test("a restricted but permitted requester can still be observed", async () => {
    const f = await h.fixture();
    await h.database().mediaUser.update({
      where: { id: f.user.id },
      data: { restricted: true },
    });
    expect(
      await observeRequesterWatch(
        h.context(watchedTransport(true)),
        f.media.id,
      ),
    ).toMatchObject({ complete: true });
  });
  test("cancellation during scoped IO aborts the complete batch rather than invalidating cache", async () => {
    const f = await h.fixture();
    const paused = pausedTransport(
      async () => new Response(null, { status: 404 }),
    );
    const controller = new AbortController();
    const context = h.context(paused.transport);
    context.watchExecution = () => ({
      signal: controller.signal,
      assertActive: () => controller.signal.throwIfAborted(),
      checkpoint: () => Promise.resolve(),
    });
    const result = observeRequesterWatch(context, f.media.id);
    const rejected = expect(result).rejects.toThrow("cancelled");
    await paused.entered;
    controller.abort(new Error("cancelled"));
    paused.resume();
    await rejected;
    expect(
      await h
        .database()
        .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
    ).toMatchObject({ observedAt: new Date(0) });
  });
});
