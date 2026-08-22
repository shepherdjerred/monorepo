import { describe, expect, test } from "vitest";
import { shouldOpenStartedExploreConversation } from "#src/lib/explore-navigation.ts";

describe("shouldOpenStartedExploreConversation", () => {
  test("opens a new conversation while the submission route remains current", () => {
    expect(
      shouldOpenStartedExploreConversation({
        submittedConversationId: null,
        submittedLocationKey: "blank-explore",
        currentLocationKey: "blank-explore",
      }),
    ).toBe(true);
  });

  test("does not override navigation while the start mutation is pending", () => {
    expect(
      shouldOpenStartedExploreConversation({
        submittedConversationId: null,
        submittedLocationKey: "blank-explore",
        currentLocationKey: "another-route",
      }),
    ).toBe(false);
  });

  test("never redirects a turn that began inside an existing conversation", () => {
    expect(
      shouldOpenStartedExploreConversation({
        submittedConversationId: "conversation-a",
        submittedLocationKey: "conversation-a",
        currentLocationKey: "conversation-a",
      }),
    ).toBe(false);
  });
});
