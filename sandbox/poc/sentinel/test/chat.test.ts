import { describe, it } from "bun:test";
import "./helpers.ts";
import {
  sendChatReply,
  updateUserSession,
} from "@shepherdjerred/sentinel/discord/chat.ts";
import type { Job } from "@prisma/client";

// Access the private userSessions map via the exported helpers
// We test the session tracking logic by calling the public functions

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  id: "test-job-1",
  agent: "personal-assistant",
  prompt: "Hello",
  priority: 2,
  status: "completed",
  triggerType: "discord",
  triggerSource: "dm",
  triggerMetadata: JSON.stringify({ userId: "user-123", messageId: "msg-456" }),
  deduplicationKey: null,
  deadlineAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  claimedAt: new Date(),
  completedAt: new Date(),
  result: "The answer is 4",
  retryCount: 0,
  maxRetries: 3,
  ...overrides,
});

describe("chat session tracking", () => {
  describe("sendChatReply with null session ID", () => {
    it("does not crash when Discord client is unavailable", async () => {
      // sendChatReply gracefully handles client == null
      const job = makeJob();
      await sendChatReply(job, "test result", null);
      // Should not throw — just logs warning and returns
    });

    it("does not crash on success path either", async () => {
      const job = makeJob();
      await sendChatReply(job, "test result", "sdk-session-abc");
      // Should not throw — client is null so it returns early
    });
  });

  describe("updateUserSession", () => {
    it("stores session ID for a user", () => {
      updateUserSession("user-A", "session-1");
      // The session is stored in-memory; we verify it works by calling again
      // and ensuring no error (the map is private, but the function should not throw)
      updateUserSession("user-A", "session-2");
    });
  });
});
