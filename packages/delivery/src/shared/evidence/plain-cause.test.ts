import { describe, expect, it } from "vitest";
import { hasTrace, plainCause } from "./plain-cause.ts";

/** An apply-safety refusal as the runtime printed it: bundle excerpt, caret, sentence, frames. */
const REFUSAL = [
  "21893 |   const response = await fetch(url, init);",
  "21894 |   if (!response.ok) {",
  "21895 |     throw new Error(`apply-safety refused: ${body}`);",
  "                ^",
  "error: Apply-safety refused golink: changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
  "      at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11)",
  "      at async runStep (/app/packages/temporal/dist/delivery-argocd.js:22110:5)",
].join("\n");

describe("the human sentence of a recorded error", () => {
  it("keeps the error's sentence and drops the source excerpt, caret and stack frames", () => {
    expect(hasTrace(REFUSAL)).toBe(true);
    expect(plainCause(REFUSAL)).toBe(
      "Apply-safety refused golink: changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
    );
  });

  it("returns a text with no trace as written, and nothing when only trace is left", () => {
    expect(hasTrace("Sync timed out at the 5 minute deadline")).toBe(false);
    expect(plainCause("Sync timed out at the 5 minute deadline")).toBe(
      "Sync timed out at the 5 minute deadline",
    );
    expect(plainCause("21895 |   throw new Error(body);")).toBe("");
  });
});
