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

    test("playMusicTool has correct id", async () => {
      const { playMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(playMusicTool.id).toBe("play-music");
    });

    test("pauseMusicTool has correct id", async () => {
      const { pauseMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(pauseMusicTool.id).toBe("pause-music");
    });

    test("resumeMusicTool has correct id", async () => {
      const { resumeMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(resumeMusicTool.id).toBe("resume-music");
    });

    test("skipTrackTool has correct id", async () => {
      const { skipTrackTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(skipTrackTool.id).toBe("skip-track");
    });

    test("stopMusicTool has correct id", async () => {
      const { stopMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(stopMusicTool.id).toBe("stop-music");
    });

    test("nowPlayingTool has correct id", async () => {
      const { nowPlayingTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(nowPlayingTool.id).toBe("now-playing");
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

    test("getQueueTool has correct id", async () => {
      const { getQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(getQueueTool.id).toBe("get-queue");
    });

    test("shuffleQueueTool has correct id", async () => {
      const { shuffleQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(shuffleQueueTool.id).toBe("shuffle-queue");
    });

    test("clearQueueTool has correct id", async () => {
      const { clearQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(clearQueueTool.id).toBe("clear-queue");
    });

    test("removeFromQueueTool has correct id", async () => {
      const { removeFromQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(removeFromQueueTool.id).toBe("remove-from-queue");
    });

    test("addToQueueTool has correct id", async () => {
      const { addToQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(addToQueueTool.id).toBe("add-to-queue");
    });
  });

  describe("controlTools", () => {
    test("exports all control tools", async () => {
      const { controlTools } = await import(
        "../../../src/mastra/tools/music/control.js"
      );

      expect(Array.isArray(controlTools)).toBe(true);
      expect(controlTools.length).toBeGreaterThan(0);
    });

    test("setVolumeTool has correct id", async () => {
      const { setVolumeTool } = await import(
        "../../../src/mastra/tools/music/control.js"
      );

      expect(setVolumeTool.id).toBe("set-volume");
    });

    test("setLoopModeTool has correct id", async () => {
      const { setLoopModeTool } = await import(
        "../../../src/mastra/tools/music/control.js"
      );

      expect(setLoopModeTool.id).toBe("set-loop-mode");
    });

    test("seekTool has correct id", async () => {
      const { seekTool } = await import(
        "../../../src/mastra/tools/music/control.js"
      );

      expect(seekTool.id).toBe("seek");
    });
  });

  describe("all music tools aggregation", () => {
    test("allMusicTools exports from index", async () => {
      const { allMusicTools } = await import(
        "../../../src/mastra/tools/music/index.js"
      );

      expect(Array.isArray(allMusicTools)).toBe(true);
      expect(allMusicTools.length).toBeGreaterThan(5);
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

  describe("tool descriptions", () => {
    test("playMusicTool description mentions playing music", async () => {
      const { playMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(playMusicTool.description.toLowerCase()).toContain("play");
    });

    test("pauseMusicTool description mentions pausing", async () => {
      const { pauseMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(pauseMusicTool.description.toLowerCase()).toContain("pause");
    });

    test("stopMusicTool description mentions stopping", async () => {
      const { stopMusicTool } = await import(
        "../../../src/mastra/tools/music/playback.js"
      );

      expect(stopMusicTool.description.toLowerCase()).toContain("stop");
    });

    test("shuffleQueueTool description mentions shuffle", async () => {
      const { shuffleQueueTool } = await import(
        "../../../src/mastra/tools/music/queue.js"
      );

      expect(shuffleQueueTool.description.toLowerCase()).toContain("shuffle");
    });
  });
});
