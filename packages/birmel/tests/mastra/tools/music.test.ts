import { describe, test, expect } from "bun:test";
import "../../setup.js";

describe("music tools", () => {
  describe("playbackTools", () => {
    test("exports all playback tools", async () => {
      const { playbackTools } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(Array.isArray(playbackTools)).toBe(true);
      expect(playbackTools.length).toBeGreaterThan(0);
    });

    test("musicPlaybackTool has correct id", async () => {
      const { musicPlaybackTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(musicPlaybackTool.id).toBe("music-playback");
    });

    test("musicPlaybackTool description mentions playback actions", async () => {
      const { musicPlaybackTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      const desc = musicPlaybackTool.description.toLowerCase();
      expect(desc).toContain("play");
    });
  });

  describe("queueTools", () => {
    test("exports all queue tools", async () => {
      const { queueTools } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(Array.isArray(queueTools)).toBe(true);
      expect(queueTools.length).toBeGreaterThan(0);
    });

    test("musicQueueTool has correct id", async () => {
      const { musicQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(musicQueueTool.id).toBe("music-queue");
    });

    test("musicQueueTool description mentions queue operations", async () => {
      const { musicQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      const desc = musicQueueTool.description.toLowerCase();
      expect(desc).toContain("queue");
    });
  });

  describe("controlTools", () => {
    test("exports control tools array", async () => {
      const { controlTools } = await import(
        "../../../src/mastra/tools/music/control.js"
      );

      expect(Array.isArray(controlTools)).toBe(true);
    });
  });

  describe("all music tools aggregation", () => {
    test("allMusicTools exports from index", async () => {
      const { allMusicTools } = await import(
        "../../../src/mastra/tools/music/index.js"
      );

      expect(Array.isArray(allMusicTools)).toBe(true);
      expect(allMusicTools.length).toBeGreaterThan(0);
    });

    test("all exported tools have correct structure", async () => {
      const { allMusicTools } = await import(
        "../../../src/mastra/tools/music/index.js"
      );

      for (const tool of allMusicTools) {
        expect(tool.id).toBeDefined();
        expect(typeof tool.id).toBe("string");
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe("string");
        expect(tool.execute).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });

    test("tool ids are unique", async () => {
      const { allMusicTools } = await import(
        "../../../src/mastra/tools/music/index.js"
      );

      const ids = allMusicTools.map((tool) => tool.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
