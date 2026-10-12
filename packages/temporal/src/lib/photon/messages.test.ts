import { describe, expect, test } from "vitest";
import { photonEnvelope, PHOTON_NOW } from "./fixtures.test-support.ts";
import { normalizePhotonMessage } from "./messages.ts";

const owners = ["+15550000001"];
describe("Photon native webhook normalization", () => {
  test("preserves the assigned line and stable project/space/message identities", () => {
    const input = photonEnvelope();
    const message = normalizePhotonMessage(
      input,
      "project",
      owners,
      PHOTON_NOW,
    );
    expect(message).toMatchObject({
      spaceId: input.space.id,
      linePhone: input.space.phone,
      senderId: owners[0],
      action: { kind: "new", provider: "claude", prompt: "remember orchid" },
    });
    expect(
      normalizePhotonMessage(
        { ...input, additive: true },
        "project",
        owners,
        PHOTON_NOW,
      ),
    ).toEqual(message);
    expect(
      normalizePhotonMessage(input, "other-project", owners, PHOTON_NOW)
        ?.messageId,
    ).not.toBe(message?.messageId);
    const changed = normalizePhotonMessage(
      photonEnvelope("changed content"),
      "project",
      owners,
      PHOTON_NOW,
    );
    expect(changed?.messageId).toBe(message?.messageId);
    expect(changed?.fingerprint).not.toBe(message?.fingerprint);
  });
  test("ignores groups, outgoing echoes, other senders, unsupported events and content", () => {
    expect(
      normalizePhotonMessage(
        { event: "future-event" },
        "project",
        owners,
        PHOTON_NOW,
      ),
    ).toBeUndefined();
    for (const alter of [
      (value: ReturnType<typeof photonEnvelope>) => {
        value.space.type = "group";
      },
      (value: ReturnType<typeof photonEnvelope>) => {
        value.message.direction = "outbound";
      },
      (value: ReturnType<typeof photonEnvelope>) => {
        value.message.sender.id = "+15550000003";
      },
      (value: ReturnType<typeof photonEnvelope>) => {
        value.message.content.type = "attachment";
      },
      (value: ReturnType<typeof photonEnvelope>) => {
        value.message.platform = "sms";
      },
    ]) {
      const value = photonEnvelope();
      alter(value);
      expect(
        normalizePhotonMessage(value, "project", owners, PHOTON_NOW),
      ).toBeUndefined();
    }
  });
  test("rejects mismatched routing and future timestamps", () => {
    const value = photonEnvelope();
    value.message.space.phone = "+15550000009";
    expect(() =>
      normalizePhotonMessage(value, "project", owners, PHOTON_NOW),
    ).toThrow("routing");
    value.message.space.phone = value.space.phone;
    value.message.timestamp = "2099-01-01T00:00:00.000Z";
    expect(() =>
      normalizePhotonMessage(value, "project", owners, PHOTON_NOW),
    ).toThrow("future");
  });
  test("responds with help for malformed commands or prompts over 4000 characters", () => {
    for (const text of [
      "/new llama hello",
      "x".repeat(4001),
      "/continue missing-prompt",
    ]) {
      expect(
        normalizePhotonMessage(
          photonEnvelope(text),
          "project",
          owners,
          PHOTON_NOW,
        )?.action,
      ).toEqual({ kind: "help" });
    }
  });
});
