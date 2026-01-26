import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";
import { getRequestContext } from "../request-context.js";
import {
  isEditorEnabled,
  getSession,
  getPendingChanges,
  updateSessionState,
  updatePrUrl,
  SessionState,
  hasValidAuth,
  createPullRequest,
  generatePRTitle,
  generatePRBody,
} from "../../../editor/index.js";

const logger = loggers.tools.child("editor.approve-changes");

export const approveChangesTool = createTool({
  id: "approve-changes",
  description: `Approve pending changes and create a pull request.
    Requires a session ID with pending changes.
    Will fail if GitHub authentication is not set up or changes have already been approved.`,
  inputSchema: z.object({
    sessionId: z.string().describe("The session ID with pending changes to approve"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        prUrl: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    const { sessionId } = ctx;
    const reqCtx = getRequestContext();

    return withToolSpan("approve-changes", reqCtx?.guildId, async () => {
      try {
        // Check if editor is enabled
        if (!isEditorEnabled()) {
          return {
            success: false,
            message: "File editing feature is not enabled.",
          };
        }

        if (!reqCtx) {
          return {
            success: false,
            message: "Could not determine request context.",
          };
        }

        // Get session
        const session = await getSession(sessionId);

        if (!session) {
          return {
            success: false,
            message: `Session '${sessionId}' not found.`,
          };
        }

        // Verify user owns the session
        if (session.userId !== reqCtx.userId) {
          return {
            success: false,
            message: "You don't have access to this session.",
          };
        }

        // Check session state
        if (session.state !== SessionState.PENDING_APPROVAL) {
          return {
            success: false,
            message: `Session is in '${session.state}' state, not pending approval.`,
          };
        }

        // Get pending changes
        const pendingChanges = getPendingChanges(session);
        if (!pendingChanges || pendingChanges.changes.length === 0) {
          return {
            success: false,
            message: "No pending changes found in session.",
          };
        }

        // Check GitHub auth
        const hasAuth = await hasValidAuth(reqCtx.userId);
        if (!hasAuth) {
          return {
            success: false,
            message:
              "GitHub authentication required. Please connect your GitHub account first.",
          };
        }

        logger.info("Approving changes", {
          sessionId: session.id,
          userId: reqCtx.userId,
          changeCount: pendingChanges.changes.length,
        });

        // Update state to approved
        await updateSessionState(session.id, SessionState.APPROVED);

        // Create PR
        const title = generatePRTitle(session.summary ?? "Changes from Discord");
        const body = generatePRBody(
          session.summary ?? "Changes made via Discord bot",
          pendingChanges.changes,
          reqCtx.userId,
        );

        const result = await createPullRequest({
          userId: reqCtx.userId,
          repoName: session.repoName,
          branchName: pendingChanges.branchName,
          baseBranch: pendingChanges.baseBranch,
          title,
          body,
          changes: pendingChanges.changes,
        });

        if (!result.success) {
          // Revert state
          await updateSessionState(session.id, SessionState.PENDING_APPROVAL);
          return {
            success: false,
            message: `Failed to create PR: ${result.error ?? "Unknown error"}`,
          };
        }

        // Update session with PR URL
        await updatePrUrl(session.id, result.prUrl ?? "");

        logger.info("PR created", {
          sessionId: session.id,
          prUrl: result.prUrl,
        });

        return {
          success: true,
          message: `Pull request created successfully!`,
          data: {
            prUrl: result.prUrl ?? "",
          },
        };
      } catch (error) {
        logger.error("Failed to approve changes", error);
        captureException(error as Error, { operation: "tool.approve-changes" });
        return {
          success: false,
          message: `Failed to approve changes: ${(error as Error).message}`,
        };
      }
    });
  },
});
