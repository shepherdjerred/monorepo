import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  get: vi.fn(),
  bind: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
}));
vi.mock("#client", () => ({
  createTemporalClient: async () => ({ workflow: {} }),
}));
vi.mock("#config/imessage.ts", () => ({ imessageChatModels: mocks.config }));
vi.mock("#lib/agent-chat-client.ts", () => ({
  resolveAgentChatBinding: mocks.resolve,
  getAgentChat: mocks.get,
  bindAgentChat: mocks.bind,
  listAgentChats: mocks.list,
}));
import { preparePhotonCommand } from "./prepare.ts";
import { PhotonCommandSchema } from "#shared/agent/agent-chat-photon.ts";
import {
  photonEnvelope,
  PHOTON_NOW,
} from "#lib/photon/fixtures.test-support.ts";
import { normalizePhotonMessage } from "#lib/photon/messages.ts";
function command(text: string, outOfOrder = false) {
  return PhotonCommandSchema.parse({
    ...normalizePhotonMessage(
      photonEnvelope(text),
      "project",
      ["+15550000001"],
      PHOTON_NOW,
    ),
    sourceSequence: 1,
    sourceEpoch: 1,
    outOfOrder,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({
    claudeModel: "claude-fixed",
    codexModel: "codex-fixed",
  });
});
describe("Photon durable chat preparation", () => {
  test.each(["claude", "codex"] as const)(
    "snapshots the provider/model with Photon-specific stable IDs: %s",
    async (provider) => {
      const prepared = await preparePhotonCommand(
        command(`/new ${provider} remember orchid`),
      );
      expect(prepared).toMatchObject({
        kind: "turn",
        command: {
          kind: "new",
          config: {
            chatId: expect.stringMatching(/^chat-photon-/),
            provider,
            model: `${provider}-fixed`,
          },
          request: { turnId: expect.stringMatching(/^photon-/) },
        },
      });
      expect(
        await preparePhotonCommand(command(`/new ${provider} remember orchid`)),
      ).toEqual(prepared);
    },
  );
  test("initial ordinary text requires an explicit new chat", async () => {
    expect(await preparePhotonCommand(command("hello"))).toMatchObject({
      kind: "message",
      content: expect.stringContaining("No selected chat"),
    });
    expect(mocks.config).not.toHaveBeenCalled();
  });
  test("late commands produce a resend response without changing selection or dispatching inference", async () => {
    expect(
      await preparePhotonCommand(command("/use previous-chat", true)),
    ).toMatchObject({
      kind: "message",
      content: expect.stringContaining("Please resend"),
    });
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
