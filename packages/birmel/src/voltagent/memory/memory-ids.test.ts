import { describe, expect, it } from "bun:test";
import {
  getServerConversationId,
  getChannelConversationId,
  getChannelMemoryConversationId,
  getPersonaConversationId,
  getOwnerConversationId,
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
    expect(getPersonaConversationId("g", "virmel")).toBe("guild:g:owner:virmel");
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentionally asserting the deprecated back-compat alias still points at the new fn
    expect(getOwnerConversationId).toBe(getPersonaConversationId);
  });

  it("does not key server memory per persona", () => {
    expect(getServerConversationId("g")).toBe("guild:g:server");
  });
});
