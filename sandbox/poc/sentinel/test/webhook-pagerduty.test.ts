import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  createTestApp,
  parseResponse,
  generateHmacSignature,
} from "./helpers.ts";

beforeEach(async () => {
  await setupTestDatabase();
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
});

function signedPagerDutyRequest(
  body: string,
  overrides?: { signature?: string },
) {
  const signature =
    overrides?.signature ??
    generateHmacSignature("test-pagerduty-secret", body, "v1=");
  return {
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      "X-PagerDuty-Signature": signature,
    },
    body,
  };
}

describe("PagerDuty webhook", () => {
  it("enqueues incident.triggered to pd-triager", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      event: {
        id: "event-123",
        event_type: "incident.triggered",
        data: {
          title: "High CPU usage",
          urgency: "high",
          html_url: "https://pagerduty.com/incidents/123",
          service: { summary: "web-server" },
        },
      },
    });

    const res = await app.request(
      "/webhook/pagerduty",
      signedPagerDutyRequest(body),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("enqueued");
    expect(parsed.jobId).toBeDefined();

    const job = await testPrisma.job.findFirst({
      where: { deduplicationKey: "pagerduty:event-123" },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("pd-triager");
    expect(job?.triggerSource).toBe("pagerduty");
  });

  it("ignores non-incident.triggered event types", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      event: {
        id: "event-456",
        event_type: "incident.resolved",
        data: {
          title: "High CPU usage",
          urgency: "high",
          html_url: "https://pagerduty.com/incidents/456",
          service: { summary: "web-server" },
        },
      },
    });

    const res = await app.request(
      "/webhook/pagerduty",
      signedPagerDutyRequest(body),
    );
    expect(res.status).toBe(200);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("ignored");
  });

  it("returns error when event field is missing", async () => {
    const app = createTestApp();
    const body = JSON.stringify({ data: { title: "no event field" } });

    const res = await app.request(
      "/webhook/pagerduty",
      signedPagerDutyRequest(body),
    );
    expect(res.status).toBe(500);
    const parsed = await parseResponse(res);
    expect(parsed.status).toBe("error");
  });

  it("rejects requests with invalid signature", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      event: { id: "event-789", event_type: "incident.triggered", data: {} },
    });

    const res = await app.request(
      "/webhook/pagerduty",
      signedPagerDutyRequest(body, {
        signature:
          "v1=invalidsignature0000000000000000000000000000000000000000000000",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects requests with missing signature header", async () => {
    const app = createTestApp();
    const res = await app.request("/webhook/pagerduty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: { id: "event-000", event_type: "incident.triggered", data: {} },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 500 when pagerdutySecret is not configured", async () => {
    const app = createTestApp({
      webhooks: {
        port: 3000,
        host: "0.0.0.0",
        githubSecret: "test-github-secret",
        pagerdutySecret: undefined,
        bugsinkSecret: "test-bugsink-secret",
        buildkiteToken: "test-buildkite-token",
      },
    });
    const res = await app.request("/webhook/pagerduty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: { id: "event-000", event_type: "incident.triggered", data: {} },
      }),
    });
    expect(res.status).toBe(500);
  });
});
