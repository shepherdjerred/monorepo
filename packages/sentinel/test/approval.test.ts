import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  cleanupAllTables,
} from "./helpers.ts";
import {
  requestApproval,
  waitForDecision,
} from "@shepherdjerred/sentinel/permissions/approval.ts";

await setupTestDatabase();

beforeEach(async () => {
  await cleanupAllTables();
});

const approvalParams = {
  agentName: "test-agent",
  sessionId: "session-123",
  toolName: "Edit",
  toolInput: JSON.stringify({ file_path: "/tmp/test.ts" }),
  expiresAt: new Date(Date.now() + 60_000),
};

describe("requestApproval", () => {
  it("should create a DB record with pending status", async () => {
    const id = await requestApproval({ ...approvalParams });

    const record = await testPrisma.approvalRequest.findUnique({ where: { id } });
    expect(record).not.toBeNull();
    expect(record!.status).toBe("pending");
    expect(record!.agent).toBe("test-agent");
    expect(record!.toolName).toBe("Edit");
    expect(record!.toolInput).toBe(JSON.stringify({ file_path: "/tmp/test.ts" }));
  });

  it("should return a valid approval ID", async () => {
    const id = await requestApproval({ ...approvalParams });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("waitForDecision", () => {
  it("should return approved when record is externally updated", async () => {
    const id = await requestApproval({ ...approvalParams });

    await testPrisma.approvalRequest.update({
      where: { id },
      data: {
        status: "approved",
        decidedBy: "test-user",
        decidedAt: new Date(),
      },
    });

    const result = await waitForDecision(id, 5000);
    expect(result.approved).toBe(true);
    expect(result.decidedBy).toBe("test-user");
  });

  it("should return denied when record is externally updated", async () => {
    const id = await requestApproval({ ...approvalParams });

    await testPrisma.approvalRequest.update({
      where: { id },
      data: {
        status: "denied",
        decidedBy: "test-user",
        reason: "Not allowed",
        decidedAt: new Date(),
      },
    });

    const result = await waitForDecision(id, 5000);
    expect(result.approved).toBe(false);
  });

  it("should auto-deny on timeout", async () => {
    const id = await requestApproval({ ...approvalParams });

    const result = await waitForDecision(id, 100);
    expect(result.approved).toBe(false);
    expect(result.reason?.toLowerCase()).toContain("timeout");
  });
});
