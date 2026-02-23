import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import type { PermissionDecision } from "@shepherdjerred/sentinel/types/permission.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { sendApprovalRequest } from "@shepherdjerred/sentinel/discord/approvals.ts";

const approvalLogger = logger.child({ module: "permissions:approval" });

type ApprovalParams = {
  agentName: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  expiresAt: Date;
};

export async function requestApproval(
  params: ApprovalParams,
): Promise<string> {
  const prisma = getPrisma();

  const request = await prisma.approvalRequest.create({
    data: {
      jobId: params.sessionId,
      agent: params.agentName,
      toolName: params.toolName,
      toolInput: params.toolInput,
      expiresAt: params.expiresAt,
    },
  });

  approvalLogger.info(
    {
      requestId: request.id,
      agent: params.agentName,
      toolName: params.toolName,
    },
    "Approval request created",
  );

  // Send Discord notification (non-blocking, never crash on failure)
  void notifyDiscord({
    requestId: request.id,
    agent: params.agentName,
    toolName: params.toolName,
    toolInput: params.toolInput,
    expiresAt: params.expiresAt,
  });

  return request.id;
}

async function notifyDiscord(params: {
  requestId: string;
  agent: string;
  toolName: string;
  toolInput: string;
  expiresAt: Date;
}): Promise<void> {
  try {
    await sendApprovalRequest(params);
  } catch (error: unknown) {
    approvalLogger.error(error, "Failed to send Discord approval notification");
  }
}

const POLL_INTERVAL_MS = 2000;

export async function waitForDecision(
  requestId: string,
  timeoutMs: number,
): Promise<PermissionDecision> {
  const prisma = getPrisma();
  const startTime = Date.now();

  approvalLogger.info(
    { requestId, timeoutMs },
    "Waiting for approval decision (polling database)",
  );

  while (Date.now() - startTime < timeoutMs) {
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (request == null) {
      return {
        approved: false,
        decidedBy: "system",
        reason: "Approval request not found",
        decidedAt: new Date(),
      };
    }

    // Check if expired
    if (request.expiresAt < new Date()) {
      await prisma.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: "denied",
          decidedBy: "system",
          reason: "Approval expired",
          decidedAt: new Date(),
        },
      });

      approvalLogger.info(
        { requestId },
        "Approval request expired, auto-denied",
      );

      return {
        approved: false,
        decidedBy: "system",
        reason: "Approval expired",
        decidedAt: new Date(),
      };
    }

    // Check if decided by external handler (e.g., Discord)
    if (request.status !== "pending") {
      const decision: PermissionDecision = {
        approved: request.status === "approved",
        decidedBy: request.decidedBy ?? "unknown",
        decidedAt: request.decidedAt ?? new Date(),
      };
      if (request.reason != null) {
        decision.reason = request.reason;
      }
      return decision;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  // Timeout reached — check final state in case a decision was made during the last sleep
  const existing = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
  });

  // If a decision was made during the final sleep interval, honor it
  if (existing != null && existing.status !== "pending") {
    const decision: PermissionDecision = {
      approved: existing.status === "approved",
      decidedBy: existing.decidedBy ?? "unknown",
      decidedAt: existing.decidedAt ?? new Date(),
    };
    if (existing.reason != null) {
      decision.reason = existing.reason;
    }
    approvalLogger.info(
      { requestId, status: existing.status },
      "Approval decision found after timeout (decided during final sleep)",
    );
    return decision;
  }

  // Still pending — auto-deny
  if (existing?.status === "pending") {
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "denied",
        decidedBy: "system",
        reason: "Approval timeout",
        decidedAt: new Date(),
      },
    });
  }

  approvalLogger.info(
    { requestId },
    "Approval request timed out, auto-denied",
  );

  return {
    approved: false,
    decidedBy: "system",
    reason: "Approval timeout",
    decidedAt: new Date(),
  };
}
