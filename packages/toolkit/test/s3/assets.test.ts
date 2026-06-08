import { describe, expect, test } from "bun:test";
import {
  assetKey,
  assetPublicUrl,
  contentTypeForFile,
  PUBLIC_BUCKET,
  PUBLIC_HOST,
} from "#lib/s3/assets.ts";

describe("contentTypeForFile", () => {
  test("maps common image extensions", () => {
    expect(contentTypeForFile("shot.png")).toBe("image/png");
    expect(contentTypeForFile("shot.JPG")).toBe("image/jpeg");
    expect(contentTypeForFile("a.jpeg")).toBe("image/jpeg");
    expect(contentTypeForFile("diagram.svg")).toBe("image/svg+xml");
    expect(contentTypeForFile("anim.gif")).toBe("image/gif");
  });

  test("handles paths and mixed case", () => {
    expect(contentTypeForFile("/tmp/before.WEBP")).toBe("image/webp");
    expect(contentTypeForFile("./out/report.PDF")).toBe("application/pdf");
  });

  test("falls back to octet-stream for unknown extensions", () => {
    expect(contentTypeForFile("mystery.xyz")).toBe("application/octet-stream");
    expect(contentTypeForFile("noext")).toBe("application/octet-stream");
  });
});

describe("assetKey", () => {
  test("builds the pr/assets/<n>/<basename> key", () => {
    expect(assetKey(1234, "after.png")).toBe("pr/assets/1234/after.png");
  });

  test("strips leading directories from the filename", () => {
    expect(assetKey(7, "/home/me/screens/before.png")).toBe(
      "pr/assets/7/before.png",
    );
  });
});

describe("assetPublicUrl", () => {
  test("returns a public.sjer.red URL under the pr/assets prefix", () => {
    expect(assetPublicUrl(1234, "/tmp/after.png")).toBe(
      `${PUBLIC_HOST}/pr/assets/1234/after.png`,
    );
  });

  test("URL-encodes the filename segment", () => {
    expect(assetPublicUrl(9, "my shot (1).png")).toBe(
      `${PUBLIC_HOST}/pr/assets/9/my%20shot%20(1).png`,
    );
  });
});

test("PUBLIC_BUCKET / PUBLIC_HOST constants", () => {
  expect(PUBLIC_BUCKET).toBe("public-sjer-red");
  expect(PUBLIC_HOST).toBe("https://public.sjer.red");
});
