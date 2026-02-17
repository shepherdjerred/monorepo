import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan } from "../../../observability/index.js";
import { getRequestContext } from "../request-context.js";
import {
  isEditorEnabled,
  getSession,
  getActiveSessionsForUser,
  getPendingChanges,
} from "../../../editor/index.js";

const logger = loggers.tools.child("editor.get-session");

export const getSessionTool = createTool({
  id: "get-editor-session",
  description: `Get information about an editor session.
    Can get a specific session by ID or list all active sessions for the current user.
    Use this when the user asks about their editing session status.`,
  inputSchema: z.object({
    sessionId: z
      .string()
      .optional()
      .describe(
        "Specific session ID to fetch. If not provided, lists all active sessions.",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        session: z
          .object({
            id: z.string(),
            repoName: z.string(),
            state: z.string(),
            summary: z.string().nullable(),
            prUrl: z.string().nullable(),
            changedFiles: z.array(z.string()).optional(),
            createdAt: z.string(),
            expiresAt: z.string(),
          })
          .optional(),
        sessions: z
          .array(
            z.object({
              id: z.string(),
              repoName: z.string(),
              state: z.string(),
              createdAt: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    const { sessionId } = ctx;
    const reqCtx = getRequestContext();

    return withToolSpan("get-editor-session", reqCtx?.guildId, async () => {
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

      // Get specific session
      if (sessionId) {
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

        const pendingChanges = getPendingChanges(session);
        const changedFiles = pendingChanges?.changes.map((c) => c.filePath);

        logger.debug("Fetched session", { sessionId: session.id });

        return {
          success: true,
          message: `Session for ${session.repoName} (${session.state})`,
          data: {
            session: {
              id: session.id,
              repoName: session.repoName,
              state: session.state,
              summary: session.summary,
              prUrl: session.prUrl,
              changedFiles,
              createdAt: session.createdAt.toISOString(),
              expiresAt: session.expiresAt.toISOString(),
            },
          },
        };
      }

      // List all active sessions for user
      const sessions = await getActiveSessionsForUser(reqCtx.userId);

      if (sessions.length === 0) {
        return {
          success: true,
          message: "You have no active editing sessions.",
          data: { sessions: [] },
        };
      }

      logger.debug("Listed user sessions", {
        userId: reqCtx.userId,
        count: sessions.length,
      });

      return {
        success: true,
        message: `You have ${String(sessions.length)} active session(s).`,
        data: {
          sessions: sessions.map((s) => ({
            id: s.id,
            repoName: s.repoName,
            state: s.state,
            createdAt: s.createdAt.toISOString(),
          })),
        },
      };
    });
  },
});
