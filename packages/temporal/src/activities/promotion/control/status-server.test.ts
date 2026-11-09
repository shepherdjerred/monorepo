import { afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("#activities/reports/report-object-store.ts", async (original) => ({
  ...(await original<object>()),
  reportReceiptStore: () => ({
    client: { send: storage.send },
    bucket: "fixture",
  }),
}));
import { promotionStatusFetch } from "./status-server.ts";
import { readProductionPromotionStatus } from "./status.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
afterEach(() => {
  vi.unstubAllEnvs();
  storage.send.mockReset();
});

it("serves only known promotion evidence with restrictive response headers", async () => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  const data = await readProductionPromotionStatus(memoryPromotionStore());
  const id = "a".repeat(64),
    forbidden = "b".repeat(64);
  data.evidence.set(id, "storm/promotion/v1/prod/evidence/fixture.png");
  data.evidence.set(forbidden, "private/unrelated.png");
  storage.send.mockResolvedValue({
    Body: {
      transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    },
  });
  const handle = promotionStatusFetch("fixture-token", () =>
    Promise.resolve(data),
  );
  const request = (key: string) =>
    handle(
      new Request(`http://status/api/v1/promotion/evidence/${key}`, {
        headers: { authorization: "Bearer fixture-token" },
      }),
    );
  const denied = await request(forbidden);
  expect(denied.status).toBe(404);
  expect(storage.send).not.toHaveBeenCalled();
  const response = await request(id);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(storage.send).toHaveBeenCalledTimes(1);
});

it("authenticates reads and rejects mutations, invalid cursors and unknown evidence", async () => {
  const store = memoryPromotionStore();
  const read = vi.fn(() => readProductionPromotionStatus(store));
  const handle = promotionStatusFetch("fixture-token", read);
  const request = (url: string, method = "GET", token = "fixture-token") =>
    handle(
      new Request(`http://status${url}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const denied = await request("/api/v1/promotion", "GET", "wrong");
  expect(denied.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  const mutation = await request("/api/v1/promotion", "POST");
  expect(mutation.status).toBe(405);
  expect(read).not.toHaveBeenCalled();
  const overview = await request("/api/v1/promotion");
  expect(overview.status).toBe(200);
  const data: unknown = await overview.json();
  expect(data).toHaveProperty("scheduling", "scheduled");
  const cursor = await request("/api/v1/promotion/history?cursor=unknown");
  expect(cursor.status).toBe(400);
  const evidence = await request(
    `/api/v1/promotion/evidence/${"0".repeat(64)}`,
  );
  expect(evidence.status).toBe(404);
});
