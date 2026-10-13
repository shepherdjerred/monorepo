import { describe, expect, it } from "vitest";
import { frameCode } from "#lib/camera.ts";

describe("code framing", () => {
  it("shows the whole short example even when its last line is focused", () => {
    const camera = frameCode({
      lineCount: 11,
      focus: [10],
      height: 836,
      lineHeight: 28,
    });
    expect(camera.y).toBe(16);
    expect(camera.scrollTop).toBe(0);
    expect(camera.height).toBe(836);
  });
  it("fills the pane at either end of a long example", () => {
    const first = frameCode({
      lineCount: 100,
      focus: [0],
      height: 836,
      lineHeight: 28,
    });
    const last = frameCode({
      lineCount: 100,
      focus: [99],
      height: 836,
      lineHeight: 28,
    });
    expect(first.y).toBe(16);
    expect(last.y + 100 * 28).toBe(836 - 16);
    expect(last.scrollTop).toBe(last.height - 836);
  });
  it("centers a middle focus while retaining the entire scrollable example", () => {
    const camera = frameCode({
      lineCount: 100,
      focus: [49],
      height: 836,
      lineHeight: 28,
    });
    expect(camera.y + 49 * 28 + 14).toBe(836 / 2);
    expect(camera.height).toBe(100 * 28 + 32);
    expect(camera.scrollTop).toBeGreaterThan(0);
    expect(camera.scrollTop).toBeLessThan(camera.height - 836);
  });
  it("starts an oversized focus at the top with readable line spacing", () => {
    const camera = frameCode({
      lineCount: 100,
      focus: [40, 80],
      height: 422,
      lineHeight: 26,
    });
    expect(camera.y + 40 * 26).toBe(16);
    expect(camera.scrollTop).toBe(40 * 26);
  });
});
