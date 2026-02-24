import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  createTestApp,
  parseResponse,
  generateHmacSignature,
  cleanupAllTables,
} from "./helpers.ts";

beforeEach(async () => {
  await setupTestDatabase();
  await cleanupAllTables();
});

describe("webhook-to-queue integration", () => {
  it("POST valid Buildkite webhook creates job with correct fields", async () => {
    const app = createTestApp();
    const payload = {
      build: {
        id: "integration-build-1",
        state: "failed",
        branch: "main",
        web_url: "https://buildkite.com/org/pipeline/builds/1",
        message: "test commit",
      },
      pipeline: { name: "monorepo" },
    };

    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();

    const job = await testPrisma.job.findFirst({
      where: { deduplicationKey: "buildkite:integration-build-1" },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("ci-fixer");
    expect(job?.triggerSource).toBe("buildkite");
    expect(job?.triggerType).toBe("webhook");
    expect(job?.status).toBe("pending");
  });

  it("POST valid GitHub workflow_run webhook creates job with correct fields", async () => {
    const app = createTestApp();
    const payload = {
      action: "completed",
      workflow_run: {
        conclusion: "failure",
        head_branch: "main",
        name: "CI",
        html_url: "https://github.com/org/repo/actions/runs/1",
        repository: { full_name: "org/repo" },
      },
    };
    const bodyString = JSON.stringify(payload);
    const signature = generateHmacSignature("test-github-secret", bodyString, "sha256=");

    const res = await app.request("/webhook/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "integration-delivery-1",
      },
      body: bodyString,
    });

    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();

    const job = await testPrisma.job.findFirst({
      where: { deduplicationKey: "github:integration-delivery-1" },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("ci-fixer");
    expect(job?.triggerSource).toBe("github");
    expect(job?.triggerType).toBe("webhook");
    expect(job?.status).toBe("pending");
  });

  it("POST duplicate Buildkite webhook creates only 1 job", async () => {
    const app = createTestApp();
    const payload = {
      build: {
        id: "integration-build-1",
        state: "failed",
        branch: "main",
        web_url: "https://buildkite.com/org/pipeline/builds/1",
        message: "test commit",
      },
      pipeline: { name: "monorepo" },
    };
    const headers = {
      "Content-Type": "application/json",
      "X-Buildkite-Token": "test-buildkite-token",
      "X-Buildkite-Event": "build.finished",
    };

    const res1 = await app.request("/webhook/buildkite", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body1 = await parseResponse(res1);
    expect(body1.status).toBe("enqueued");

    const res2 = await app.request("/webhook/buildkite", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body2 = await parseResponse(res2);
    expect(body2.status).toBe("enqueued");
    expect(body2.jobId).toBe(body1.jobId);

    const jobs = await testPrisma.job.findMany({
      where: { deduplicationKey: "buildkite:integration-build-1" },
    });
    expect(jobs).toHaveLength(1);
  });

  it("POST valid Bugsink webhook creates job with correct fields", async () => {
    const app = createTestApp();
    const payload = {
      title: "Integration test error",
      project: "sentinel",
      url: "https://bugsink.example.com/issues/integration-1",
    };

    const res = await app.request("/webhook/bugsink/test-bugsink-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();

    const job = await testPrisma.job.findUnique({
      where: { id: body.jobId! },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("personal-assistant");
    expect(job?.triggerSource).toBe("bugsink");
    expect(job?.triggerType).toBe("webhook");
    expect(job?.status).toBe("pending");
  });
});
