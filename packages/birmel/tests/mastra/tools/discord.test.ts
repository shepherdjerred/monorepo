import { describe, test, expect } from "bun:test";
import "../../setup.js";

describe("discord tools", () => {
  describe("messageTools", () => {
    test("exports all message tools", async () => {
      const { messageTools } = await import(
        "../../../src/mastra/tools/discord/messages.js"
      );

      expect(Array.isArray(messageTools)).toBe(true);
      expect(messageTools.length).toBeGreaterThan(0);
    });

    test("sendMessageTool has correct id", async () => {
      const { sendMessageTool } = await import(
        "../../../src/mastra/tools/discord/messages.js"
      );

      expect(sendMessageTool.id).toBe("send-message");
    });

    test("deleteMessageTool has correct id", async () => {
      const { deleteMessageTool } = await import(
        "../../../src/mastra/tools/discord/messages.js"
      );

      expect(deleteMessageTool.id).toBe("delete-message");
    });

    test("pinMessageTool has correct id", async () => {
      const { pinMessageTool } = await import(
        "../../../src/mastra/tools/discord/messages.js"
      );

      expect(pinMessageTool.id).toBe("pin-message");
    });
  });

  describe("guildTools", () => {
    test("exports all guild tools", async () => {
      const { guildTools } = await import(
        "../../../src/mastra/tools/discord/guild.js"
      );

      expect(Array.isArray(guildTools)).toBe(true);
      expect(guildTools.length).toBeGreaterThan(0);
    });

    test("getGuildInfoTool has correct id", async () => {
      const { getGuildInfoTool } = await import(
        "../../../src/mastra/tools/discord/guild.js"
      );

      expect(getGuildInfoTool.id).toBe("get-guild-info");
    });
  });

  describe("channelTools", () => {
    test("exports all channel tools", async () => {
      const { channelTools } = await import(
        "../../../src/mastra/tools/discord/channels.js"
      );

      expect(Array.isArray(channelTools)).toBe(true);
      expect(channelTools.length).toBeGreaterThan(0);
    });

    test("listChannelsTool has correct id", async () => {
      const { listChannelsTool } = await import(
        "../../../src/mastra/tools/discord/channels.js"
      );

      expect(listChannelsTool.id).toBe("list-channels");
    });

    test("createChannelTool has correct id", async () => {
      const { createChannelTool } = await import(
        "../../../src/mastra/tools/discord/channels.js"
      );

      expect(createChannelTool.id).toBe("create-channel");
    });
  });

  describe("roleTools", () => {
    test("exports all role tools", async () => {
      const { roleTools } = await import(
        "../../../src/mastra/tools/discord/roles.js"
      );

      expect(Array.isArray(roleTools)).toBe(true);
      expect(roleTools.length).toBeGreaterThan(0);
    });

    test("listRolesTool has correct id", async () => {
      const { listRolesTool } = await import(
        "../../../src/mastra/tools/discord/roles.js"
      );

      expect(listRolesTool.id).toBe("list-roles");
    });
  });

  describe("memberTools", () => {
    test("exports all member tools", async () => {
      const { memberTools } = await import(
        "../../../src/mastra/tools/discord/members.js"
      );

      expect(Array.isArray(memberTools)).toBe(true);
      expect(memberTools.length).toBeGreaterThan(0);
    });

    test("getMemberTool has correct id", async () => {
      const { getMemberTool } = await import(
        "../../../src/mastra/tools/discord/members.js"
      );

      expect(getMemberTool.id).toBe("get-member");
    });
  });

  describe("moderationTools", () => {
    test("exports all moderation tools", async () => {
      const { moderationTools } = await import(
        "../../../src/mastra/tools/discord/moderation.js"
      );

      expect(Array.isArray(moderationTools)).toBe(true);
      expect(moderationTools.length).toBeGreaterThan(0);
    });

    test("kickMemberTool has correct id", async () => {
      const { kickMemberTool } = await import(
        "../../../src/mastra/tools/discord/moderation.js"
      );

      expect(kickMemberTool.id).toBe("kick-member");
    });

    test("banMemberTool has correct id", async () => {
      const { banMemberTool } = await import(
        "../../../src/mastra/tools/discord/moderation.js"
      );

      expect(banMemberTool.id).toBe("ban-member");
    });
  });

  describe("voiceTools", () => {
    test("exports all voice tools", async () => {
      const { voiceTools } = await import(
        "../../../src/mastra/tools/discord/voice.js"
      );

      expect(Array.isArray(voiceTools)).toBe(true);
      expect(voiceTools.length).toBeGreaterThan(0);
    });

    test("joinVoiceChannelTool has correct id", async () => {
      const { joinVoiceChannelTool } = await import(
        "../../../src/mastra/tools/discord/voice.js"
      );

      expect(joinVoiceChannelTool.id).toBe("join-voice-channel");
    });
  });

  describe("allDiscordTools aggregation", () => {
    test("all discord tools are exported from index", async () => {
      const discordTools = await import(
        "../../../src/mastra/tools/discord/index.js"
      );

      expect(discordTools.messageTools).toBeDefined();
      expect(discordTools.guildTools).toBeDefined();
      expect(discordTools.channelTools).toBeDefined();
      expect(discordTools.roleTools).toBeDefined();
      expect(discordTools.memberTools).toBeDefined();
      expect(discordTools.moderationTools).toBeDefined();
      expect(discordTools.voiceTools).toBeDefined();
    });

    test("allDiscordTools combines all tool arrays", async () => {
      const { allDiscordTools } = await import(
        "../../../src/mastra/tools/discord/index.js"
      );

      expect(Array.isArray(allDiscordTools)).toBe(true);
      expect(allDiscordTools.length).toBeGreaterThan(20);
    });
  });

  describe("tool structure validation", () => {
    test("each tool has required properties", async () => {
      const { allDiscordTools } = await import(
        "../../../src/mastra/tools/discord/index.js"
      );

      for (const tool of allDiscordTools) {
        expect(tool.id).toBeDefined();
        expect(typeof tool.id).toBe("string");
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe("string");
        expect(tool.execute).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });

    test("tool ids are unique", async () => {
      const { allDiscordTools } = await import(
        "../../../src/mastra/tools/discord/index.js"
      );

      const ids = allDiscordTools.map((tool) => tool.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
