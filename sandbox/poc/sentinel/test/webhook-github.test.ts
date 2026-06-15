import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  testConfig,
  createTestApp,
  parseResponse,
  generateHmacSignature,
} from "./helpers.ts";

function signedGitHubRequest(
  body: string,
  event: string,
  overrides?: { signature?: string; delivery?: string },
) {
  const signature =
    overrides?.signature ??
    generateHmacSignature("test-github-secret", body, "sha256=");
  return {
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": overrides?.delivery ?? "test-delivery-123",
    },
    body,
  };
}

beforeEach(async () => {
  await setupTestDatabase();
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
});

describe("GitHub webhook", () => {
  it("enqueues ci-fixer for workflow_run failure", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      action: "completed",
      workflow_run: {
        conclusion: "failure",
        name: "CI",
        head_branch: "main",
        html_url: "https://github.com/org/repo/actions/runs/123",
        repository: { full_name: "org/repo" },
      },
    });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "workflow_run"),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("enqueued");
    expect(parsed.jobId).toBeDefined();

    const job = await testPrisma.job.findFirst({
      where: { agent: "ci-fixer", triggerSource: "github" },
    });
    expect(job).not.toBeNull();
  });

  it("ignores workflow_run with success conclusion", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      action: "completed",
      workflow_run: {
        conclusion: "success",
        name: "CI",
        head_branch: "main",
        html_url: "https://github.com/org/repo/actions/runs/456",
        repository: { full_name: "org/repo" },
      },
    });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "workflow_run"),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("ignored");
  });

  it("enqueues ci-fixer for check_suite failure", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      action: "completed",
      check_suite: {
        conclusion: "failure",
        head_branch: "main",
        url: "https://api.github.com/repos/org/repo/check-suites/789",
      },
      repository: { full_name: "org/repo" },
    });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "check_suite"),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("enqueued");
    expect(parsed.jobId).toBeDefined();

    const job = await testPrisma.job.findFirst({
      where: { agent: "ci-fixer", triggerSource: "github" },
    });
    expect(job).not.toBeNull();
  });

  it("rejects requests without signature header", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "test-delivery-123",
      },
      body: JSON.stringify({ action: "completed" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with invalid HMAC signature", async () => {
    const app = createTestApp();
    const body = JSON.stringify({ action: "completed" });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "workflow_run", {
        signature:
          "sha256=invalid0000000000000000000000000000000000000000000000000000000000",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 when githubSecret is not configured", async () => {
    const app = createTestApp({
      webhooks: { ...testConfig.webhooks, githubSecret: undefined },
    });
    const body = JSON.stringify({ action: "completed" });
    const res = await app.request("/webhook/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=anything",
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "test-delivery-123",
      },
      body,
    });
    expect(res.status).toBe(500);
  });

  it("ignores non-handled event types", async () => {
    const app = createTestApp();
    const body = JSON.stringify({ action: "completed" });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "push"),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("ignored");
  });

  it("returns 400 when workflow_run field is missing", async () => {
    const app = createTestApp();
    const body = JSON.stringify({ action: "completed" });
    const res = await app.request(
      "/webhook/github",
      signedGitHubRequest(body, "workflow_run"),
    );
    expect(res.status).toBe(400);
  });
});
