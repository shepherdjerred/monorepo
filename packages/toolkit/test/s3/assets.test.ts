import { describe, expect, test } from "bun:test";
import {
  assetKey,
  assetPublicUrl,
  contentTypeForFile,
  dirFileKey,
  firstDuplicateKey,
  isCastFile,
  markdownForAsset,
  PUBLIC_BUCKET,
  PUBLIC_HOST,
  publicUrlForKey,
} from "#lib/s3/assets.ts";

describe("contentTypeForFile", () => {
  test("maps common image extensions", () => {
    expect(contentTypeForFile("shot.png")).toBe("image/png");
    expect(contentTypeForFile("shot.JPG")).toBe("image/jpeg");
    expect(contentTypeForFile("a.jpeg")).toBe("image/jpeg");
    expect(contentTypeForFile("diagram.svg")).toBe("image/svg+xml");
    expect(contentTypeForFile("anim.gif")).toBe("image/gif");
  });

  test("maps video, recording, and static-site extensions", () => {
    expect(contentTypeForFile("clip.mp4")).toBe("video/mp4");
    expect(contentTypeForFile("demo.cast")).toBe("application/x-asciicast");
    expect(contentTypeForFile("styles.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForFile("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForFile("mod.mjs")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeForFile("engine.wasm")).toBe("application/wasm");
    expect(contentTypeForFile("font.woff2")).toBe("font/woff2");
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

describe("isCastFile", () => {
  test("matches .cast regardless of case, nothing else", () => {
    expect(isCastFile("demo.cast")).toBe(true);
    expect(isCastFile("/tmp/run.CAST")).toBe(true);
    expect(isCastFile("demo.cast.html")).toBe(false);
    expect(isCastFile("demo.mp4")).toBe(false);
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

describe("dirFileKey", () => {
  test("nests the relative path under the directory name", () => {
    expect(dirFileKey(42, "demo-site", "index.html")).toBe(
      "pr/assets/42/demo-site/index.html",
    );
    expect(dirFileKey(42, "demo-site", "assets/app.js")).toBe(
      "pr/assets/42/demo-site/assets/app.js",
    );
  });
});

describe("publicUrlForKey", () => {
  test("encodes each path segment without encoding the separators", () => {
    expect(publicUrlForKey("pr/assets/9/my shot (1).png")).toBe(
      `${PUBLIC_HOST}/pr/assets/9/my%20shot%20(1).png`,
    );
    expect(publicUrlForKey("pr/assets/9/demo site/sub dir/a b.html")).toBe(
      `${PUBLIC_HOST}/pr/assets/9/demo%20site/sub%20dir/a%20b.html`,
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

describe("markdownForAsset", () => {
  const url = "https://public.sjer.red/pr/assets/1/x";

  test("images render inline", () => {
    expect(markdownForAsset("after.png", url)).toBe(`![after.png](${url})`);
    expect(markdownForAsset("anim.gif", url)).toBe(`![anim.gif](${url})`);
  });

  test("videos are labeled links (GitHub never embeds external video)", () => {
    expect(markdownForAsset("flow.mp4", url)).toBe(
      `[flow.mp4 (video)](${url})`,
    );
    expect(markdownForAsset("flow.mov", url)).toBe(
      `[flow.mov (video)](${url})`,
    );
  });

  test("html and pdf are labeled links", () => {
    expect(markdownForAsset("index.html", url)).toBe(
      `[index.html (demo)](${url})`,
    );
    expect(markdownForAsset("report.pdf", url)).toBe(
      `[report.pdf (pdf)](${url})`,
    );
  });

  test("unknown types are plain links", () => {
    expect(markdownForAsset("data.bin", url)).toBe(`[data.bin](${url})`);
  });
});

describe("firstDuplicateKey", () => {
  test("returns undefined when all keys are unique", () => {
    expect(
      firstDuplicateKey([
        { key: "pr/assets/1/before.png", source: "/a/before.png" },
        { key: "pr/assets/1/after.png", source: "/b/after.png" },
      ]),
    ).toBeUndefined();
  });

  test("detects two files colliding on the same basename key", () => {
    expect(
      firstDuplicateKey([
        { key: "pr/assets/1/shot.png", source: "/a/shot.png" },
        { key: "pr/assets/1/shot.png", source: "/b/shot.png" },
      ]),
    ).toEqual({
      key: "pr/assets/1/shot.png",
      first: "/a/shot.png",
      second: "/b/shot.png",
    });
  });

  test("detects a directory file colliding with a flat file", () => {
    expect(
      firstDuplicateKey([
        { key: "pr/assets/1/demo/index.html", source: "demo/index.html" },
        { key: "pr/assets/1/demo/index.html", source: "/tmp/demo/index.html" },
      ]),
    ).toMatchObject({ key: "pr/assets/1/demo/index.html" });
  });

  test("detects a user file colliding with a generated cast player page", () => {
    expect(
      firstDuplicateKey([
        { key: "pr/assets/1/demo.cast", source: "demo.cast" },
        {
          key: "pr/assets/1/demo.cast.html",
          source: "demo.cast (generated player page)",
        },
        { key: "pr/assets/1/demo.cast.html", source: "/tmp/demo.cast.html" },
      ]),
    ).toEqual({
      key: "pr/assets/1/demo.cast.html",
      first: "demo.cast (generated player page)",
      second: "/tmp/demo.cast.html",
    });
  });
});
