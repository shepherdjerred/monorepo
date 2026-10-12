import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { safeOutputForPublication } from "#src/agent/public-output.ts";
import type { AgentOutput } from "#src/domain/schemas.ts";

const privateText = "Private Linear context fixture";
const output: AgentOutput = {
  status: "changed",
  commitTitle: privateText,
  summary: privateText,
  verification: [privateText],
  resolvedFindingKeys: [],
  resolvedFindings: [],
  visualTargets: [],
};
const context = `Linear comments present for agent context:\n${JSON.stringify(privateText)}`;

describe("host-authored public evidence", () => {
  test("publishes measured host checks while stripping every agent text field", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jpe-public-"));
    try {
      await Bun.write(
        path.join(directory, "file.ts"),
        "export const value = 1;",
      );
      const publicOutput = await safeOutputForPublication(output, {
        checkout: directory,
        paths: ["file.ts"],
        linearContext: context,
        hostVerification: ["PASSED: bun run test"],
      });
      expect(JSON.stringify(publicOutput)).not.toContain(privateText);
      expect(publicOutput.verification).toEqual(["PASSED: bun run test"]);
      expect(publicOutput.summary).toContain("1 files");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  test("refuses a file containing private comments even with passing checks", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jpe-public-"));
    try {
      await Bun.write(path.join(directory, "file.ts"), privateText);
      await expect(
        safeOutputForPublication(output, {
          checkout: directory,
          paths: ["file.ts"],
          linearContext: context,
          hostVerification: ["PASSED: bun run test"],
        }),
      ).rejects.toThrow("refusing to publish");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
