import { expect, test } from "vitest";
import { z } from "zod";
import fixture from "@shepherdjerred/ops-model/fixtures/verified-root-release.json" with { type: "json" };
import {
  publishVerifiedRootReleaseReceipt,
  verifiedRootReleasePatch,
} from "./argocd-verified-receipt.ts";

const requestId = "00000000-0000-4000-8000-000000000042";
const revision = "2.0.0-42";

test("publication compares resourceVersion before adding the exact operation receipt", () => {
  const result = verifiedRootReleasePatch(
    fixture,
    requestId,
    revision,
    "2026-10-13T00:02:00.000Z",
  );
  expect(result.patch[0]).toEqual({
    op: "test",
    path: "/metadata/resourceVersion",
    value: "42",
  });
  expect(result.patch.at(-1)).toMatchObject({
    op: "add",
    path: "/metadata/annotations/ops.sjer.red~1verified-root-release",
  });
  expect(result.receipt).toMatchObject({
    requestId,
    revision,
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  expect(() =>
    verifiedRootReleasePatch(
      fixture,
      "00000000-0000-4000-8000-000000000043",
      revision,
      "2026-10-13T00:02:00.000Z",
    ),
  ).toThrow("does not match");
});

test("an optimistic concurrency failure cannot establish release verification", async () => {
  await expect(
    publishVerifiedRootReleaseReceipt({
      application: fixture,
      requestId,
      revision,
      serverUrl: "https://argocd.test",
      token: "test",
      fetcher: async () => new Response("conflict", { status: 409 }),
    }),
  ).rejects.toThrow("HTTP 409");
});

test("requires a matching receipt in the publication response", async () => {
  const unverified = { ...fixture, metadata: { name: "apps" } };
  await expect(
    publishVerifiedRootReleaseReceipt({
      application: fixture,
      requestId,
      revision,
      serverUrl: "https://argocd.test",
      token: "test",
      fetcher: async () => Response.json(unverified),
    }),
  ).rejects.toThrow("read-back");
});

test("does not annotate a naturally successful root operation", async () => {
  const application = structuredClone(fixture);
  application.status.operationState.phase = "Succeeded";
  let calls = 0;
  await publishVerifiedRootReleaseReceipt({
    application,
    requestId,
    revision,
    serverUrl: "https://argocd.test",
    token: "test",
    fetcher: async () => {
      calls += 1;
      return Response.json(application);
    },
  });
  expect(calls).toBe(0);
});

test("publishes and validates the exact receipt returned by ArgoCD", async () => {
  let method: string | undefined;
  await publishVerifiedRootReleaseReceipt({
    application: fixture,
    requestId,
    revision,
    serverUrl: "https://argocd.test",
    token: "test",
    fetcher: async (_url, init) => {
      method = init?.method;
      const request = z
        .object({ patch: z.string() })
        .parse(JSON.parse(z.string().parse(init?.body)));
      const operations = z
        .array(z.object({ path: z.string(), value: z.unknown() }))
        .parse(JSON.parse(request.patch));
      const annotation = operations.find(
        (entry) =>
          entry.path ===
          "/metadata/annotations/ops.sjer.red~1verified-root-release",
      );
      const confirmed = structuredClone(fixture);
      confirmed.metadata.annotations["ops.sjer.red/verified-root-release"] = z
        .string()
        .parse(annotation?.value);
      return Response.json(confirmed);
    },
  });
  expect(method).toBe("PATCH");
});
