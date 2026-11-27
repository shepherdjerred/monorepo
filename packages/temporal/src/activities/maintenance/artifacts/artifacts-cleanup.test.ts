import { expect, test } from "vitest";
import { z } from "zod";
import {
  cleanupArtifactsWithDeps,
  type ArtifactsHttpFetcher,
} from "./artifacts-cleanup.ts";

const RESULT = {
  status: "ok",
  expiredSessions: 1,
  purgedBoards: 2,
  deletedBlobs: 3,
  deletedOrphans: 4,
  prunedEvents: 5,
  more: true,
};

const failing: ArtifactsHttpFetcher = () =>
  Promise.resolve(new Response("unavailable", { status: 503 }));
const drifted: ArtifactsHttpFetcher = () =>
  Promise.resolve(
    Response.json({ result: { data: { ...RESULT, more: "yes" } } }),
  );

test("posts to the internal host with a valid runner actor and parses the result", async () => {
  let seen: { url: string; init: RequestInit | undefined } | undefined;
  const fetchImpl: ArtifactsHttpFetcher = (input, init) => {
    seen = {
      url: input instanceof Request ? input.url : input.toString(),
      init,
    };
    return Promise.resolve(Response.json({ result: { data: RESULT } }));
  };
  await expect(
    cleanupArtifactsWithDeps({ runId: "run-1", fetchImpl }),
  ).resolves.toEqual(RESULT);
  expect(seen?.url).toBe(
    "http://artifacts.artifacts.svc.cluster.local:7440/trpc/maintenance.cleanup",
  );
  expect(seen?.init?.method).toBe("POST");
  const headers = new Headers(seen?.init?.headers);
  expect(headers.get("content-type")).toBe("application/json");
  const encoded = headers.get("X-Artifacts-Actor") ?? "";
  // The shape of `ActorSchema` in `@shepherdjerred/artifacts/contract`, which
  // this package does not depend on: a runner, keyed `<namespace>:<id>`.
  const actor = z
    .strictObject({
      key: z.string().regex(/^[a-z0-9][a-z0-9._-]*:\S+$/u),
      kind: z.literal("runner"),
      name: z.string().min(1),
      metadata: z.strictObject({ harness: z.string(), sessionId: z.string() }),
    })
    .parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  expect(actor.key).toBe("runner:temporal:run-1");
});

test("fails on a non-2xx response and on a body that breaks the contract", async () => {
  await expect(
    cleanupArtifactsWithDeps({ runId: "run-1", fetchImpl: failing }),
  ).rejects.toThrow("HTTP 503");
  await expect(
    cleanupArtifactsWithDeps({ runId: "run-1", fetchImpl: drifted }),
  ).rejects.toThrow();
});
