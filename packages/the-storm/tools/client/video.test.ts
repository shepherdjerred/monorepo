import { describe, expect, test } from "vitest";
import { validateFrames } from "./video-frames.ts";

function receipt() {
  return {
    schema: 1,
    kind: "rwf-rendered-frames",
    acceptance: "unaccepted",
    source: "minecraft-framebuffer",
    fps: 30,
    requestedFrames: 3,
    complete: true,
    error: "",
    frames: Array.from({ length: 3 }, (_, index) => ({
      frame: {
        index,
        elapsedNanos: Math.floor((index * 1_000_000_000) / 30),
        worldTick: 100 + index,
        camera: {
          position: [0, 120, 0],
          yaw: 135,
          pitch: 30,
          fov: 70,
          hud: false,
          nameplates: false,
        },
      },
      file: `${index.toString().padStart(6, "0")}.png`,
      sha256: "a".repeat(64),
    })),
  };
}

describe("rendered frame evidence", () => {
  test("permits only subpixel camera rounding within the neutral tolerances", () => {
    const rounded = receipt();
    const frame = rounded.frames[1];
    if (frame === undefined) throw new Error("Missing fixture frame");
    frame.frame.camera.fov = 70.00002;
    frame.frame.camera.position[0] = 0.0000001;
    expect(validateFrames(rounded).frames).toHaveLength(3);
    frame.frame.camera.fov = 70.001;
    expect(() => validateFrames(rounded)).toThrow("clock or camera");
  });
  test("checks the original sampling slots and inventory", () => {
    expect(validateFrames(receipt()).frames).toHaveLength(3);
    const missing = receipt();
    missing.frames.pop();
    expect(() => validateFrames(missing)).toThrow("incomplete");
    const reordered = receipt();
    reordered.frames.reverse();
    expect(() => validateFrames(reordered)).toThrow("reordered");
  });

  test("rejects catch-up frames, camera movement and backwards world clocks", () => {
    const late = receipt();
    const frame = late.frames[1];
    if (frame === undefined) throw new Error("Missing fixture frame");
    frame.frame.elapsedNanos = 66_666_666;
    expect(() => validateFrames(late)).toThrow("sampling slot");
    frame.frame.elapsedNanos = 33_333_333;
    frame.frame.camera.yaw = 90;
    expect(() => validateFrames(late)).toThrow("clock or camera");
    frame.frame.camera.yaw = 135;
    frame.frame.worldTick = 99;
    expect(() => validateFrames(late)).toThrow("clock or camera");
  });

  test("cannot turn cancellation, visible labels or path traversal into evidence", () => {
    const incomplete = receipt();
    incomplete.complete = false;
    expect(() => validateFrames(incomplete)).toThrow();
    const frame = incomplete.frames[0];
    if (frame === undefined) throw new Error("Missing fixture frame");
    incomplete.complete = true;
    frame.frame.camera.nameplates = true;
    expect(() => validateFrames(incomplete)).toThrow();
    frame.frame.camera.nameplates = false;
    frame.file = "../../other.png";
    expect(() => validateFrames(incomplete)).toThrow();
  });
});
