import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  downloadImage,
  downloadImageWithRetry,
  isImageAttachment,
  isPrivateOrReservedIp,
  sanitizeUrlForLogging,
  validateSafePublicImageUrl,
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

const mockPrivateResolver = async () => [
  { address: "192.168.1.100", family: 4 },
];
const mockPublicResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

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

  test("aborts and rejects when streaming response exceeds 20MB limit", async () => {
    // 11MB + 11MB = 22MB > 20MB limit
    const chunk1 = new Uint8Array(11 * 1024 * 1024);
    const chunk2 = new Uint8Array(11 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(downloadImage("https://example.com/huge.png")).rejects.toThrow(
      /Image too large/,
    );
  });

  test("rejects non-HTTPS download URLs", async () => {
    await expect(downloadImage("http://example.com/test.png")).rejects.toThrow(
      /only HTTPS is allowed/,
    );
  });

  test("rejects redirects to internal addresses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/admin.png" },
      }),
    );

    await expect(
      downloadImage("https://example.com/redirect.png"),
    ).rejects.toThrow(/private or reserved IP/);
  });

  test("follows safe redirects to legitimate URLs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/final.png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(PNG_HEADER, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    const result = await downloadImage("https://example.com/initial.png");
    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.buffer)).toEqual(PNG_HEADER);
  });
});

describe("sanitizeUrlForLogging", () => {
  test("strips query string HMAC and signatures from Discord CDN URLs", () => {
    const discordUrl =
      "https://cdn.discordapp.com/attachments/123/456/sample.png?ex=66e3b5e4&is=66e26464&hm=abc12345def#preview";
    expect(sanitizeUrlForLogging(discordUrl)).toBe(
      "https://cdn.discordapp.com/attachments/123/456/sample.png",
    );
  });

  test("returns invalid-url placeholder on malformed URL strings", () => {
    expect(sanitizeUrlForLogging("not a valid url")).toBe("<invalid-url>");
  });
});

describe("isPrivateOrReservedIp", () => {
  test("identifies private and reserved IPv4 addresses", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
  });

  test("identifies private and reserved IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("::")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
  });

  test("allows public IP addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("2606:4700:10::6814:179a")).toBe(false);
  });
});

describe("validateSafePublicImageUrl", () => {
  test("rejects non-HTTPS URLs", async () => {
    await expect(
      validateSafePublicImageUrl("http://example.com/test.png"),
    ).rejects.toThrow("only HTTPS is allowed");
  });

  test("rejects forbidden hostnames", async () => {
    await expect(
      validateSafePublicImageUrl("https://localhost/test.png"),
    ).rejects.toThrow("Forbidden image URL");
    await expect(
      validateSafePublicImageUrl("https://myhost.local/test.png"),
    ).rejects.toThrow("Forbidden image URL");
    await expect(
      validateSafePublicImageUrl(
        "https://flipt.flipt.svc.cluster.local/test.png",
      ),
    ).rejects.toThrow("Forbidden image URL");
  });

  test("rejects direct private IP literals", async () => {
    await expect(
      validateSafePublicImageUrl("https://127.0.0.1/test.png"),
    ).rejects.toThrow("private or reserved IP address");
    await expect(
      validateSafePublicImageUrl("https://10.1.2.3/test.png"),
    ).rejects.toThrow("private or reserved IP address");
  });

  test("rejects hostnames resolving to private IPs via DNS", async () => {
    await expect(
      validateSafePublicImageUrl(
        "https://attacker.example.com/test.png",
        mockPrivateResolver,
      ),
    ).rejects.toThrow("resolves to private or reserved IP");
  });

  test("accepts hostnames resolving to public IPs via DNS", async () => {
    const result = await validateSafePublicImageUrl(
      "https://safe.example.com/test.png",
      mockPublicResolver,
    );
    expect(result.hostname).toBe("safe.example.com");
  });
});
