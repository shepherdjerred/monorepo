import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  createTestApp,
  parseResponse,
} from "./helpers.ts";

beforeEach(async () => {
  await setupTestDatabase();
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
});

describe("Buildkite webhook", () => {
  it("rejects requests without token", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "wrong-token",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("ignores non-build.finished events", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.started",
      },
      body: JSON.stringify({ build: { state: "running" } }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
  });

  it("ignores non-failed builds", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: { state: "passed", branch: "main", id: "123" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
    expect(body.reason).toBe("not a failure");
  });

  it("ignores failures on non-main branches", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: { state: "failed", branch: "feature/test", id: "123" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
    expect(body.reason).toBe("not main branch");
  });

  it("enqueues failed main branch builds", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: {
          id: "build-456",
          state: "failed",
          branch: "main",
          web_url: "https://buildkite.com/org/pipeline/builds/123",
          message: "fix: broken thing",
        },
        pipeline: {
          name: "monorepo",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();

    // Verify job was created in the database
    const job = await testPrisma.job.findFirst({
      where: { deduplicationKey: "buildkite:build-456" },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("ci-fixer");
    expect(job?.triggerSource).toBe("buildkite");
  });
});

describe("Bugsink webhook (token-in-URL)", () => {
  it("rejects requests with wrong token", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/bugsink/wrong-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Error", project: "test", url: "http://example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct token", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/bugsink/test-bugsink-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "TypeError: null is not an object",
        project: "sentinel",
        url: "https://bugsink.example.com/issues/123",
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();
  });

  it("returns 404 for old bugsink path without token", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/bugsink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
