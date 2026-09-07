import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  downloadImage,
  downloadImageWithRetry,
  isImageAttachment,
} from "@shepherdjerred/birmel/utils/image.ts";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const GIF_HEADER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("isImageAttachment", () => {
  test("accepts supported image mime types", () => {
    expect(isImageAttachment({ contentType: "image/png" })).toBe(true);
  });

  test("rejects unsupported or missing mime types", () => {
    expect(isImageAttachment({ contentType: "text/html" })).toBe(false);
    expect(isImageAttachment({ contentType: null })).toBe(false);
  });
});

describe("downloadImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("downloads image and uses supported content-type header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(PNG_HEADER, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const result = await downloadImage("https://example.com/test.png");
    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.buffer)).toEqual(PNG_HEADER);
  });

  test("sniffs image type when content-type is generic or missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JPEG_HEADER, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const result = await downloadImage("https://example.com/test.bin");
    expect(result.contentType).toBe("image/jpeg");
    expect(Buffer.from(result.buffer)).toEqual(JPEG_HEADER);
  });

  test("sniffs webp and gif headers successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(WEBP_HEADER, {
        status: 200,
        headers: {},
      }),
    );

    const webpResult = await downloadImage("https://example.com/unknown");
    expect(webpResult.contentType).toBe("image/webp");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(GIF_HEADER, {
        status: 200,
        headers: {},
      }),
    );

    const gifResult = await downloadImage("https://example.com/unknown");
    expect(gifResult.contentType).toBe("image/gif");
  });

  test("rejects non-image responses such as HTML error pages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body>Error page</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      downloadImage("https://example.com/error-page"),
    ).rejects.toThrow("Unsupported image type");
  });

  test("aborts immediately when caller signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("turn cancelled"));

    await expect(
      downloadImage("https://example.com/test.png", controller.signal),
    ).rejects.toThrow("turn cancelled");
  });

  test("retries once on failure in downloadImageWithRetry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        new Response(PNG_HEADER, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    const result = await downloadImageWithRetry("https://example.com/test.png");
    expect(result.contentType).toBe("image/png");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
