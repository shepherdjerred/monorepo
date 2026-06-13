import { describe, expect, it } from "bun:test";
import {
  getServerConversationId,
  getChannelConversationId,
  getChannelMemoryConversationId,
  getPersonaConversationId,
} from "./index.ts";

describe("memory conversation ids", () => {
  it("keeps channel saved-memory distinct from the auto-history channel id", () => {
    // Critical invariant: explicit channel memory must NOT collide with the
    // VoltAgent auto-managed conversation history for the same channel.
    expect(getChannelMemoryConversationId("c1")).not.toBe(
      getChannelConversationId("c1"),
    );
  });

  it("keys persona memory per persona", () => {
    expect(getPersonaConversationId("g", "virmel")).not.toBe(
      getPersonaConversationId("g", "aaron"),
    );
  });

  it("keeps the persona id stable on the legacy :owner: segment", () => {
    // Data-preservation invariant: persona memory keeps using the legacy
    // `:owner:` conversationId segment so stored memory survives the rename.
    expect(getPersonaConversationId("g", "virmel")).toBe(
      "guild:g:owner:virmel",
    );
  });

  it("does not key server memory per persona", () => {
    expect(getServerConversationId("g")).toBe("guild:g:server");
  });
});
