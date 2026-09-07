import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getStagedAttachments,
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";

const mockGenerateImage = vi.fn();
const mockDownloadImageWithRetry = vi.fn();

vi.mock("ai", () => ({
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
}));

vi.mock("@shepherdjerred/birmel/utils/image.ts", () => ({
  downloadImageWithRetry: (...args: unknown[]) =>
    mockDownloadImageWithRetry(...args),
  sanitizeUrlForLogging: (url: string) => url.split("?")[0] ?? url,
}));

import {
  generateImageTool,
  GenerateImageInputSchema,
} from "@shepherdjerred/birmel/agent-tools/tools/images/generate-image.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

const trustedUserId = "186665676134547461";

const dummyContext: RequestContext = {
  sourceChannelId: "channel-1",
  sourceMessageId: "msg-1",
  guildId: "guild-1",
  userId: trustedUserId,
  ownsSourceReply: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getConfig().imageGeneration.enabled = true;
});

describe("generateImageTool - text-to-image and gating", () => {
  test("rejects execution when image generation is disabled in configuration", async () => {
    getConfig().imageGeneration.enabled = false;
    const context: RequestContext = { ...dummyContext };
    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "a cozy mountain cabin in winter",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("disabled in configuration");
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  test("generates an image from text prompt and stages attachment in RequestContext", async () => {
    const fakeImageBytes = Buffer.from("generated-png-data");
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: fakeImageBytes.toString("base64"),
      },
    });

    const context: RequestContext = { ...dummyContext };
    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "a cozy mountain cabin in winter",
          aspectRatio: "16:9",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("successfully generated");
    expect(result.prompt).toBe("a cozy mountain cabin in winter");
    expect(result.aspectRatio).toBe("16:9");

    expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "a cozy mountain cabin in winter",
        aspectRatio: "16:9",
      }),
    );

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(1);
    expect(staged[0]?.name).toMatch(/^birmel-\d+\.png$/u);
    expect(staged[0]?.description).toBe("a cozy mountain cabin in winter");
    expect(staged[0]?.contentType).toBe("image/png");
    expect(Buffer.from(staged[0]?.data ?? []).toString()).toBe(
      "generated-png-data",
    );
  });

  test("truncates attachment description to 1024 characters for long prompts", async () => {
    const longPrompt = "a".repeat(1500);
    const fakeImageBytes = Buffer.from("generated-png-data");
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: fakeImageBytes.toString("base64"),
      },
    });

    const context: RequestContext = { ...dummyContext };
    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: longPrompt,
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(true);
    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(1);
    expect(staged[0]?.description).toHaveLength(1024);
    expect(staged[0]?.description).toBe("a".repeat(1024));
  });
});

describe("generateImageTool - reference image editing", () => {
  test("derives reference image from turn context when referenceImageUrl is omitted", async () => {
    const referenceBytes = Buffer.from("context-reference-image");
    const outputBytes = Buffer.from("tweaked-from-context");

    mockDownloadImageWithRetry.mockResolvedValueOnce({
      buffer: referenceBytes,
      contentType: "image/jpeg",
    });
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: outputBytes.toString("base64"),
      },
    });

    const context: RequestContext = {
      ...dummyContext,
      sourceImageAttachments: [
        {
          url: "https://cdn.discordapp.com/attachments/123/456/user-upload.jpg",
          contentType: "image/jpeg",
        },
      ],
    };

    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "make this cyberpunk style",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(true);
    expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
      "https://cdn.discordapp.com/attachments/123/456/user-upload.jpg",
      expect.any(Object),
    );

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "make this cyberpunk style",
        files: [
          {
            type: "data",
            data: new Uint8Array(referenceBytes),
            mediaType: "image/jpeg",
          },
        ],
      }),
    );

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(1);
    expect(Buffer.from(staged[0]?.data ?? []).toString()).toBe(
      "tweaked-from-context",
    );
  });

  test("downloads explicit reference image and preserves actual media type", async () => {
    const referenceBytes = Buffer.from("original-reference-image");
    const outputBytes = Buffer.from("tweaked-image-output");

    mockDownloadImageWithRetry.mockResolvedValueOnce({
      buffer: referenceBytes,
      contentType: "image/webp",
    });
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: outputBytes.toString("base64"),
      },
    });

    const referenceUrl =
      "https://cdn.discordapp.com/attachments/123/456/cat.webp";
    const context: RequestContext = { ...dummyContext };

    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "make this cat wear sunglasses",
          aspectRatio: "1:1",
          referenceImageUrl: referenceUrl,
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(true);
    expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
      referenceUrl,
      expect.any(Object),
    );

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "make this cat wear sunglasses",
        aspectRatio: "1:1",
        files: [
          {
            type: "data",
            data: new Uint8Array(referenceBytes),
            mediaType: "image/webp",
          },
        ],
      }),
    );

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(1);
    expect(Buffer.from(staged[0]?.data ?? []).toString()).toBe(
      "tweaked-image-output",
    );
  });

  test("fails the edit when reference image download fails", async () => {
    mockDownloadImageWithRetry.mockRejectedValueOnce(
      new Error("404 Not Found"),
    );

    const context: RequestContext = { ...dummyContext };
    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "a sunset over the ocean",
          referenceImageUrl: "https://example.com/missing.png",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("404 Not Found");
    expect(mockGenerateImage).not.toHaveBeenCalled();

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(0);
  });
});

describe("generateImageTool - error handling and validation", () => {
  test("returns clean error result when generateImage throws", async () => {
    mockGenerateImage.mockRejectedValueOnce(
      new Error("OpenRouter rate limit reached"),
    );

    const context: RequestContext = { ...dummyContext };
    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "a portrait of an astronaut",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("OpenRouter rate limit reached");

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(0);
  });

  test("handles aborted signal by rejecting with abort error", async () => {
    const controller = new AbortController();
    controller.abort();

    const context: RequestContext = { ...dummyContext };
    await expect(
      runWithRequestContext(context, async () => {
        return await generateImageTool.execute(
          {
            prompt: "should abort immediately",
          },
          { abortSignal: controller.signal },
        );
      }),
    ).rejects.toThrow();

    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  test("rejects image edit when referenced message resolution failed", async () => {
    const context: RequestContext = {
      ...dummyContext,
      referenceResolutionError: {
        referencedMessageId: "999888777",
        error: "Unknown Message",
      },
    };

    const result = await runWithRequestContext(context, async () => {
      return await generateImageTool.execute(
        {
          prompt: "make this image brighter",
        },
        { signal: new AbortController().signal },
      );
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(
      "failed to resolve referenced message 999888777",
    );
    expect(result.message).toContain("Unknown Message");
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  describe("GenerateImageInputSchema", () => {
    test("accepts valid aspect ratios", () => {
      const valid = GenerateImageInputSchema.parse({
        prompt: "test",
        aspectRatio: "16:9",
      });
      expect(valid.aspectRatio).toBe("16:9");
    });

    test("rejects invalid aspect ratios", () => {
      expect(() =>
        GenerateImageInputSchema.parse({
          prompt: "test",
          aspectRatio: "2:1",
        }),
      ).toThrow();
    });

    test("rejects invalid referenceImageUrl", () => {
      expect(() =>
        GenerateImageInputSchema.parse({
          prompt: "test",
          referenceImageUrl: "not-a-valid-url",
        }),
      ).toThrow();
    });
  });
});
