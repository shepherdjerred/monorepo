import { describe, expect, test } from "vitest";
import { frameScale, presetSize, FRAME_SANDBOX } from "./frame-viewer.tsx";
import { zoomAt } from "./image-viewer.tsx";
import { resolveReference } from "./markdown-viewer.tsx";

describe("frame presets", () => {
  const container = { width: 900, height: 700 };

  test("fixed presets use their own size", () => {
    expect(presetSize("mobile", null, container)).toEqual({
      width: 390,
      height: 844,
    });
    expect(presetSize("desktop", null, container)).toEqual({
      width: 1440,
      height: 900,
    });
  });

  test("a published viewport of the same width keeps its height", () => {
    expect(
      presetSize("desktop", { width: 1440, height: 1000 }, container),
    ).toEqual({
      width: 1440,
      height: 1000,
    });
    expect(
      presetSize("mobile", { width: 1440, height: 1000 }, container),
    ).toEqual({
      width: 390,
      height: 844,
    });
  });

  test("responsive fills the container", () => {
    expect(
      presetSize("responsive", null, { width: 900.4, height: 700.2 }),
    ).toEqual({
      width: 900,
      height: 700,
    });
  });

  test("scales to fit the width, or both axes, and never above 1 when fitting both", () => {
    const size = { width: 1440, height: 900 };
    expect(frameScale(size, container, "width")).toBeCloseTo(900 / 1440);
    expect(frameScale(size, { width: 3000, height: 2000 }, "both")).toBe(1);
    expect(frameScale(size, { width: 1440, height: 450 }, "both")).toBe(0.5);
  });

  test("the sandbox never allows the same origin", () => {
    expect(FRAME_SANDBOX.split(" ")).toEqual([
      "allow-scripts",
      "allow-forms",
      "allow-popups",
    ]);
    expect(FRAME_SANDBOX).not.toContain("allow-same-origin");
  });
});

describe("zoomAt", () => {
  const origin = { x: 500, y: 400 };

  test("zooming at the center changes only the scale", () => {
    const next = zoomAt({ scale: 1, x: 0, y: 0 }, 2, origin, origin);
    expect(next).toEqual({ scale: 2, x: 0, y: 0 });
  });

  test("keeps the point under the cursor fixed", () => {
    const cursor = { x: 700, y: 500 };
    const next = zoomAt({ scale: 1, x: 0, y: 0 }, 2, cursor, origin);
    // The image point under the cursor, in image-local space, before and after.
    const before = { x: cursor.x - origin.x, y: cursor.y - origin.y };
    const after = {
      x: (cursor.x - origin.x - next.x) / next.scale,
      y: (cursor.y - origin.y - next.y) / next.scale,
    };
    expect(after).toEqual(before);
  });

  test("clamps to 8x and returns home at 1x", () => {
    expect(zoomAt({ scale: 6, x: 0, y: 0 }, 5, origin, origin).scale).toBe(8);
    expect(zoomAt({ scale: 2, x: 30, y: 30 }, 0.1, origin, origin)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("resolveReference", () => {
  const prefix = "https://content.example/_t/abc/";
  const document = `${prefix}docs/notes.md`;

  test("an absolute http(s) URL is external", () => {
    expect(
      resolveReference("https://example.com/a.png", document, prefix),
    ).toEqual({
      kind: "external",
      href: "https://example.com/a.png",
    });
    expect(
      resolveReference("//example.com/a.png", document, prefix)?.kind,
    ).toBe("external");
  });

  test("other schemes are refused", () => {
    expect(
      resolveReference("javascript:alert(1)", document, prefix),
    ).toBeNull();
    expect(resolveReference("data:text/html,x", document, prefix)).toBeNull();
    expect(resolveReference("file:///etc/passwd", document, prefix)).toBeNull();
  });

  test("a relative path resolves against the document inside the prefix", () => {
    expect(resolveReference("./pic.png", document, prefix)).toEqual({
      kind: "local",
      href: `${prefix}docs/pic.png`,
    });
    expect(resolveReference("../top.png", document, prefix)).toEqual({
      kind: "local",
      href: `${prefix}top.png`,
    });
  });

  test("a relative path that climbs out of the prefix is refused", () => {
    expect(
      resolveReference("../../other/pic.png", document, prefix),
    ).toBeNull();
    expect(resolveReference("/_t/other/pic.png", document, prefix)).toBeNull();
  });
});
