import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  createTestApp,
} from "./helpers.ts";

beforeEach(async () => {
  await setupTestDatabase();
});

describe("GET /livez", () => {
  it("returns 200 with ok", async () => {
    const app = createTestApp();
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("GET /healthz", () => {
  it("returns 200 with ok when database is healthy", async () => {
    const app = createTestApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("GET /metrics", () => {
  it("returns 200 with queue stats", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toHaveProperty("pending");
    expect(body).toHaveProperty("running");
    expect(body).toHaveProperty("completed");
    expect(body).toHaveProperty("failed");
    expect(body).toHaveProperty("cancelled");
    expect(body).toHaveProperty("awaitingApproval");
  });
});
