import { describe, expect, test } from "vitest";
import {
  clientToFramePixels,
  contentAnchor,
  contentAnchorToClient,
  displayToPage,
  docAnchorFromFramePixels,
  frameAnchor,
  framePixelsFromDocAnchor,
  framePixelsToClient,
  normalizeInRect,
  normalizeRotation,
  pageAnchor,
  pageAnchorToClient,
  pageToDisplay,
  pdfRenderScale,
  denormalizeInRect,
  type Rect,
  type Rotation,
} from "./geometry.ts";

const rect: Rect = { left: 100, top: 50, width: 400, height: 200 };

describe("rectangles", () => {
  test("normalizes and denormalizes a point", () => {
    const unit = normalizeInRect(rect, { x: 300, y: 150 });
    expect(unit).toEqual({ x: 0.5, y: 0.5 });
    expect(denormalizeInRect(rect, { x: 0.5, y: 0.5 })).toEqual({
      x: 300,
      y: 150,
    });
  });

  test("clamps outside points and refuses an empty rect", () => {
    expect(normalizeInRect(rect, { x: 0, y: 1000 })).toEqual({ x: 0, y: 1 });
    expect(normalizeInRect({ ...rect, width: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("frames", () => {
  // A 1440x900 frame drawn at 0.5 inside a 720x450 box at (100, 50).
  const drawn: Rect = { left: 100, top: 50, width: 720, height: 450 };

  test("client to frame pixels and back round-trips under scale", () => {
    const pixels = clientToFramePixels(drawn, 0.5, { x: 460, y: 275 });
    expect(pixels).toEqual({ x: 720, y: 450 });
    expect(framePixelsToClient(drawn, 0.5, pixels ?? { x: 0, y: 0 })).toEqual({
      x: 460,
      y: 275,
    });
  });

  test("a frame anchor is a fraction of the drawn box", () => {
    expect(frameAnchor(drawn, { x: 460, y: 275 })).toEqual({
      type: "frame",
      x: 0.5,
      y: 0.5,
    });
  });

  test("a doc anchor adds the scroll offset and stores width-relative x", () => {
    const doc = {
      scrollX: 0,
      scrollY: 600,
      width: 1440,
      height: 4000,
      path: "index.html",
    };
    const anchor = docAnchorFromFramePixels({ x: 720, y: 100 }, doc, 1440);
    expect(anchor).toEqual({
      type: "doc",
      path: "index.html",
      x: 0.5,
      y: 700,
      docWidth: 1440,
    });
  });

  test("a doc anchor maps back to the frame pixel it came from", () => {
    const doc = {
      scrollX: 0,
      scrollY: 600,
      width: 1440,
      height: 4000,
      path: "index.html",
    };
    const anchor = docAnchorFromFramePixels({ x: 720, y: 100 }, doc, 1440);
    if (anchor.type !== "doc") throw new Error("expected a doc anchor");
    expect(framePixelsFromDocAnchor(anchor, doc, 1440)).toEqual({
      x: 720,
      y: 100,
    });
  });

  test("a document that reflowed narrower scales y by the width ratio", () => {
    const anchor = {
      type: "doc",
      path: "index.html",
      x: 0.5,
      y: 1000,
      docWidth: 1440,
    } as const;
    const narrow = {
      scrollX: 0,
      scrollY: 0,
      width: 720,
      height: 8000,
      path: "index.html",
    };
    expect(framePixelsFromDocAnchor(anchor, narrow, 720)).toEqual({
      x: 360,
      y: 500,
    });
  });
});

describe("PDF pages", () => {
  const rotations: Rotation[] = [0, 90, 180, 270];

  test("display and page coordinates are inverses for every rotation", () => {
    for (const rotation of rotations) {
      const page = displayToPage({ x: 0.2, y: 0.7 }, rotation);
      const back = pageToDisplay(page, rotation);
      expect(back.x).toBeCloseTo(0.2);
      expect(back.y).toBeCloseTo(0.7);
    }
  });

  test("a rotated page stores unrotated coordinates", () => {
    // The top-right corner of a page shown rotated 90 degrees clockwise is the
    // top-left corner of the original page.
    expect(displayToPage({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 0 });
    expect(displayToPage({ x: 0, y: 0 }, 180)).toEqual({ x: 1, y: 1 });
    expect(displayToPage({ x: 0, y: 0 }, 270)).toEqual({ x: 1, y: 0 });
  });

  test("a page anchor round-trips through the drawn page for page 2 rotated", () => {
    const pageRect: Rect = { left: 40, top: 700, width: 600, height: 800 };
    const point = { x: 340, y: 1100 };
    for (const rotation of rotations) {
      const anchor = pageAnchor(2, pageRect, rotation, point);
      expect(anchor?.type).toBe("page");
      if (anchor?.type !== "page") continue;
      expect(anchor.page).toBe(2);
      const client = pageAnchorToClient(anchor, pageRect, rotation);
      expect(client.x).toBeCloseTo(point.x);
      expect(client.y).toBeCloseTo(point.y);
    }
  });

  test("normalizes any rotation to a quarter turn", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });

  test("the render scale is cssScale times dpr until the pixel cap", () => {
    expect(
      pdfRenderScale({ pageWidth: 600, pageHeight: 800, cssScale: 1, dpr: 2 }),
    ).toBe(2);
    const capped = pdfRenderScale({
      pageWidth: 600,
      pageHeight: 800,
      cssScale: 4,
      dpr: 3,
    });
    expect(600 * 800 * capped * capped).toBeLessThanOrEqual(16_000_000 + 1);
    expect(capped).toBeLessThan(12);
  });
});

describe("scrolled content", () => {
  test("a content anchor survives scrolling because the rect carries the offset", () => {
    // The article is 600 wide and has scrolled 300 px: its top is at -250.
    const content: Rect = { left: 200, top: -250, width: 600, height: 4000 };
    const anchor = contentAnchor("notes.md", content, { x: 500, y: 100 });
    expect(anchor).toEqual({
      type: "doc",
      path: "notes.md",
      x: 0.5,
      y: 350,
      docWidth: 600,
    });
    if (anchor?.type !== "doc") throw new Error("expected a doc anchor");
    const scrolledFurther: Rect = { ...content, top: -450 };
    expect(contentAnchorToClient(anchor, scrolledFurther)).toEqual({
      x: 500,
      y: -100,
    });
  });
});
