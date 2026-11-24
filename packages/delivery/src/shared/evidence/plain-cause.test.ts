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

const SENTENCE =
  "Apply-safety refused golink: changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4";

/**
 * Golink's apply-safety evidence as recorded: the executor's own words, then
 * an excerpt run on after them on the same line, more excerpt lines, the
 * error's sentence and frames.
 */
const RECORDED = [
  "Delivery apply-safety refused the Application before any sync; 21895 | ${body}`);",
  "21896 | }",
  "21897 | const managed = ManagedResourcesSchema.parse(",
  "error: Refusing golink sync because the desired state changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
  "      at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11)",
  "      at async main (/app/packages/temporal/dist/delivery-argocd.js:23688:30)",
].join("\n");

describe("the human sentence of a recorded error", () => {
  it("keeps the error's sentence and drops the source excerpt, caret and stack frames", () => {
    expect(hasTrace(REFUSAL)).toBe(true);
    expect(plainCause(REFUSAL)).toBe(SENTENCE);
  });

  it("drops an excerpt run on after prose on the same line, and the lines under it", () => {
    expect(hasTrace(RECORDED)).toBe(true);
    expect(plainCause(RECORDED)).toBe(
      "Delivery apply-safety refused the Application before any sync; Refusing golink sync because the desired state changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
    );
    for (const text of [plainCause(RECORDED), plainCause(REFUSAL)]) {
      expect(text).not.toContain("21895");
      expect(text).not.toContain("delivery-argocd.js");
      expect(text).not.toContain("assertApplySafe");
    }
  });

  it("drops an excerpt and frames that a runtime ran together onto one line", () => {
    const flat =
      "Apply-safety refused the sync; 21895 | ${body}`); 21896 | } 21897 | const managed = ManagedResourcesSchema.parse( at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11) at async main (/app/packages/temporal/dist/delivery-argocd.js:23688:30)";
    expect(hasTrace(flat)).toBe(true);
    expect(plainCause(flat)).toBe("Apply-safety refused the sync");
    const frames =
      "The sync was refused at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11) at async main (/app/packages/temporal/dist/delivery-argocd.js:23688:30)";
    expect(plainCause(frames)).toBe("The sync was refused");
  });

  it("joins the lines as prose: no doubled punctuation, no dangling colon or list marker", () => {
    // The apply-safety evidence of the live Golink refusal.
    const live = [
      "Apply-safety refused golink at 2.0.0-1018413 before any sync; restored the source Argo last synced (history 44).; 21895 | ${body}`);",
      "21896 | }",
      "error: Refusing golink sync because the read-only apply-safety preflight found:",
      "- acid.zalan.do/postgresql golink/golink-postgresql changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
      "      at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11)",
    ].join("\n");
    const joined = plainCause(live);
    expect(joined).toBe(
      "Apply-safety refused golink at 2.0.0-1018413 before any sync; restored the source Argo last synced (history 44). Refusing golink sync because the read-only apply-safety preflight found: acid.zalan.do/postgresql golink/golink-postgresql changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
    );
    for (const stray of [".;", "found;", "; -", ";;"])
      expect(joined).not.toContain(stray);
    // Several list items after a colon read as one list.
    expect(
      plainCause(
        [
          "21895 | throw",
          "error: The preflight found:",
          "- a changes /x from 1 to 2",
          "- b changes /y from 3 to 4",
        ].join("\n"),
      ),
    ).toBe(
      "The preflight found: a changes /x from 1 to 2; b changes /y from 3 to 4",
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
