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
}));

import {
  generateImageTool,
  GenerateImageInputSchema,
} from "@shepherdjerred/birmel/agent-tools/tools/images/generate-image.ts";

const trustedUserId = "186665676134547461";

describe("generateImageTool", () => {
  const dummyContext: RequestContext = {
    sourceChannelId: "channel-1",
    sourceMessageId: "msg-1",
    guildId: "guild-1",
    userId: trustedUserId,
    ownsSourceReply: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

  test("downloads reference image and passes file data for image-to-image edits", async () => {
    const referenceBytes = Buffer.from("original-reference-image");
    const outputBytes = Buffer.from("tweaked-image-output");

    mockDownloadImageWithRetry.mockResolvedValueOnce(referenceBytes);
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: outputBytes.toString("base64"),
      },
    });

    const referenceUrl =
      "https://cdn.discordapp.com/attachments/123/456/cat.png";
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
    expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(referenceUrl);

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "make this cat wear sunglasses",
        aspectRatio: "1:1",
        files: [
          {
            type: "data",
            data: new Uint8Array(referenceBytes),
            mediaType: "image/png",
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

  test("falls back to text-only prompt when reference image download fails", async () => {
    const outputBytes = Buffer.from("fallback-image-output");

    mockDownloadImageWithRetry.mockRejectedValueOnce(
      new Error("404 Not Found"),
    );
    mockGenerateImage.mockResolvedValueOnce({
      image: {
        base64: outputBytes.toString("base64"),
      },
    });

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

    expect(result.success).toBe(true);
    expect(mockDownloadImageWithRetry).toHaveBeenCalledWith(
      "https://example.com/missing.png",
    );
    const callArgs: unknown = mockGenerateImage.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (callArgs != null && typeof callArgs === "object") {
      expect("files" in callArgs).toBe(false);
    }

    const staged = getStagedAttachments(context);
    expect(staged).toHaveLength(1);
  });

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
