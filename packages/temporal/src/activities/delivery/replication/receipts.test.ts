import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  listDeliveryReplications,
  recordDeliveryReplication,
} from "./receipts.ts";

const transport = vi.fn<typeof fetch>();
const artifact = {
  artifactId: "ci/monorepo/41/archive/site",
  buildId: "ci/monorepo/41",
  serviceId: "sjer-red",
  uri: "s3://delivery-artifacts/sites/sjer.red/41.tar",
  digest: `sha256:${"a".repeat(64)}`,
};
const replication = {
  store: "r2" as const,
  bucket: "seaweedfs-backups",
  key: `objects/${"b".repeat(64)}`,
  digest: artifact.digest,
  replicatedAt: "2026-10-20T12:00:00.000Z",
};

beforeEach(() => {
  transport.mockReset();
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("DELIVERY_API_URL", "https://delivery.test/");
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "executor-test-credential");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(index = 0): { url: string; init: RequestInit | undefined } {
  const call = transport.mock.calls[index];
  if (call === undefined) throw new Error("Delivery API was not called");
  const [input, init] = call;
  if (!(input instanceof URL))
    throw new TypeError("Delivery API request must be a URL");
  return { url: input.href, init };
}

test("lists pending replications with the executor credential", async () => {
  transport.mockResolvedValueOnce(Response.json({ artifacts: [artifact] }));
  await expect(listDeliveryReplications()).resolves.toEqual({
    artifacts: [artifact],
  });
  const { url, init } = request();
  expect(url).toBe("https://delivery.test/api/v1/replication/pending");
  expect(init?.method).toBe("GET");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer executor-test-credential",
  );
});

test("records a receipt on the artifact and treats a conflicting receipt as terminal", async () => {
  transport.mockResolvedValueOnce(
    Response.json({
      id: artifact.artifactId,
      component: "archive:site",
      kind: "archive",
      uri: artifact.uri,
      digest: artifact.digest,
      runtimeDigests: [],
      requires: {},
      version: "build-41",
      origin: { kind: "first-party" },
      serviceId: artifact.serviceId,
      buildId: artifact.buildId,
      sourceRevision: "c".repeat(40),
      createdAt: "2026-10-20T11:00:00.000Z",
      replication,
    }),
  );
  await expect(
    recordDeliveryReplication({ artifactId: artifact.artifactId, replication }),
  ).resolves.toBeUndefined();
  const { url, init } = request();
  expect(url).toBe("https://delivery.test/api/v1/artifacts/replication");
  expect(init?.method).toBe("POST");
  expect(init?.body).toBe(
    JSON.stringify({ artifactId: artifact.artifactId, replication }),
  );

  transport.mockResolvedValueOnce(
    Response.json(
      {
        error: {
          code: "CONFLICT",
          message: "A different replication receipt is stored",
          requestId: "request-1",
        },
      },
      { status: 409 },
    ),
  );
  await expect(
    recordDeliveryReplication({ artifactId: artifact.artifactId, replication }),
  ).rejects.toMatchObject({ type: "DeliveryApi:CONFLICT", nonRetryable: true });
});
