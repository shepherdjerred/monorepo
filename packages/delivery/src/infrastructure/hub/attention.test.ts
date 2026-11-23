import { describe, expect, it } from "vitest";
import { firstLine } from "./attention.ts";

describe("the first line of a recorded cause", () => {
  it("is the first line of plain prose, and nothing for none", () => {
    expect(firstLine("Sync timed out\nmore detail")).toBe("Sync timed out");
    expect(firstLine("  \n")).toBeNull();
    expect(firstLine(null)).toBeNull();
  });

  it("is the error's sentence, never a source excerpt or a stack frame", () => {
    const recorded = [
      "Delivery apply-safety refused the Application before any sync; 21895 | ${body}`);",
      "21896 | }",
      "21897 | const managed = ManagedResourcesSchema.parse(",
      "error: Refusing golink sync because the desired state changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
      "      at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11)",
    ].join("\n");
    expect(firstLine(recorded)).toBe(
      "Delivery apply-safety refused the Application before any sync; Refusing golink sync because the desired state changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
    );
    expect(firstLine("21895 |   throw new Error(body);")).toBeNull();
  });
});
