import { afterEach, expect, test, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { identityPreviewOptions } from "./preview.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each(["success", "failure"])(
  "selection reset discards a late %s and preserves the newer reviewed response",
  async (outcome) => {
    const mediaId = crypto.randomUUID();
    const releaseId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const context = DefaultTargetViewSchema.parse({
      schemaVersion: 2,
      scope: { mediaId, edition: "default" },
      expected: { mediaVersion: 0, targetVersion: 3 },
      access: "detail",
      target: { generation: 0, availability: "wanted", lineage: "resolved" },
      ownRequests: [],
      allowedProtectiveActions: [],
    });
    const stale = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<boolean>();
    const current = {
      schemaVersion: 1,
      releaseId,
      candidateDigest: "a".repeat(64),
      previewDigest: "b".repeat(64),
      providerId: "fixture",
      title: "Reviewed title",
      identityReasons: [],
      references: [],
      canonical: {
        kind: "movie",
        mediaId,
        mediaVersion: 0,
        catalogDigest: "c".repeat(64),
      },
      canonicalTitle: "Canonical title",
      canonicalYear: 2020,
      media: [
        {
          id: mediaId,
          title: "Canonical title",
          year: 2020,
          version: 0,
          generation: 0,
        },
      ],
      sponsorRequestId: crypto.randomUUID(),
      numberingDigest: null,
      qualityBlockers: [],
      edition: {
        policy: "standard_unmarked",
        accepted: true,
        reasons: [],
        candidate: { kind: "standard_unmarked" },
        current: [],
        members: [],
      },
      confirmationAllowed: true,
    };
    vi.stubGlobal("document", { cookie: "media-csrf=fixture" });
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => {
          started.resolve(true);
          return stale.promise;
        })
        .mockResolvedValueOnce(Response.json(current)),
    );
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const observer = new MutationObserver(
      client,
      identityPreviewOptions({ actorId, mediaId, releaseId }),
    );
    const observed: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      if (result.data !== undefined)
        observed.push(result.data.preview.previewDigest);
    });
    try {
      const oldRequest = observer.mutate({ mediaIds: [mediaId], context });
      const settledOld = Promise.allSettled([oldRequest]);
      await started.promise;
      observer.reset();
      expect(observer.getCurrentResult().data).toBeUndefined();
      // Returning to the original selection must still create a new review.
      await observer.mutate({ mediaIds: [mediaId], context });
      if (outcome === "success")
        stale.resolve(
          Response.json({ ...current, previewDigest: "d".repeat(64) }),
        );
      else
        stale.resolve(
          Response.json(
            {
              error: { code: "stale_preview", message: "Old selection failed" },
            },
            { status: 409 },
          ),
        );
      const results = await settledOld;
      expect(results[0]?.status).toBe(
        outcome === "success" ? "fulfilled" : "rejected",
      );
      expect(observer.getCurrentResult().data?.preview.previewDigest).toBe(
        current.previewDigest,
      );
      expect(observer.getCurrentResult().data?.context.expected).toEqual({
        mediaVersion: 0,
        targetVersion: 3,
      });
      expect(observer.getCurrentResult().error).toBeNull();
      expect(observed).not.toContain("d".repeat(64));
    } finally {
      unsubscribe();
      client.clear();
    }
  },
);
