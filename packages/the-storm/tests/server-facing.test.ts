import { describe, expect, it } from "vitest";
import { parseServerFacing } from "#e2e/harness/bot.ts";

describe("native Minecraft rotation output", () => {
  it("accepts ordinary and scientific float notation without rounding the server evidence", () => {
    expect(
      parseServerFacing(
        "MondoProof has the following entity data: [-3.3586658E-11f, 25.8f]",
      ),
    ).toEqual({ yaw: -3.3586658e-11, pitch: 25.8 });
    expect(parseServerFacing("data: [90.0f, -41.85f]")).toEqual({
      yaw: 90,
      pitch: -41.85,
    });
  });

  it("rejects missing or malformed rotation evidence", () => {
    expect(() => parseServerFacing("No entity was found")).toThrow(
      "No rotation",
    );
    expect(() => parseServerFacing("data: [1..2f, 3f]")).toThrow("No rotation");
    expect(() => parseServerFacing("data: [NaNf, 3f]")).toThrow("No rotation");
  });
});
