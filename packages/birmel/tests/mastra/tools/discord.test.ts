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

    test("manageMessageTool has correct id", async () => {
      const { manageMessageTool } = await import(
        "../../../src/mastra/tools/discord/messages.js"
      );

      expect(manageMessageTool.id).toBe("manage-message");
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

    test("manageGuildTool has correct id", async () => {
      const { manageGuildTool } = await import(
        "../../../src/mastra/tools/discord/guild.js"
      );

      expect(manageGuildTool.id).toBe("manage-guild");
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

    test("manageChannelTool has correct id", async () => {
      const { manageChannelTool } = await import(
        "../../../src/mastra/tools/discord/channels.js"
      );

      expect(manageChannelTool.id).toBe("manage-channel");
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

    test("manageRoleTool has correct id", async () => {
      const { manageRoleTool } = await import(
        "../../../src/mastra/tools/discord/roles.js"
      );

      expect(manageRoleTool.id).toBe("manage-role");
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

    test("manageMemberTool has correct id", async () => {
      const { manageMemberTool } = await import(
        "../../../src/mastra/tools/discord/members.js"
      );

      expect(manageMemberTool.id).toBe("manage-member");
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

    test("moderateMemberTool has correct id", async () => {
      const { moderateMemberTool } = await import(
        "../../../src/mastra/tools/discord/moderation.js"
      );

      expect(moderateMemberTool.id).toBe("moderate-member");
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
    });

    test("allDiscordTools combines all tool arrays", async () => {
      const { allDiscordTools } = await import(
        "../../../src/mastra/tools/discord/index.js"
      );

      expect(Array.isArray(allDiscordTools)).toBe(true);
      expect(allDiscordTools.length).toBeGreaterThan(10);
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
