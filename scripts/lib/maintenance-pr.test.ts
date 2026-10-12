import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { parseMaintenancePr, readMaintenancePr } from "./maintenance-pr.ts";

const pr = { number: 42, isDraft: true, headRefOid: "a".repeat(40) };

describe("maintenance PR validation", () => {
  test("preserves valid draft and ready states and ignores unrelated fields", () => {
    expect(parseMaintenancePr({ ...pr, title: "candidate" })).toEqual(pr);
    expect(parseMaintenancePr({ ...pr, isDraft: false }).isDraft).toBe(false);
  });

  test.each([
    null,
    [],
    "draft",
    {},
    { ...pr, number: 0 },
    { ...pr, number: -1 },
    { ...pr, number: 1.5 },
    { ...pr, number: Number.MAX_SAFE_INTEGER + 1 },
    { ...pr, number: "42" },
    { ...pr, isDraft: "false" },
    { ...pr, isDraft: undefined },
    { ...pr, headRefOid: "A".repeat(40) },
    { ...pr, headRefOid: "a".repeat(39) },
    { ...pr, headRefOid: 42 },
  ])("rejects malformed PR data %#", (value) => {
    expect(() => parseMaintenancePr(value)).toThrow("Invalid maintenance PR");
  });

  test.each([{}, null, [pr, pr], [{ ...pr, isDraft: "false" }]])(
    "rejects malformed or ambiguous query responses %#",
    async (response) => {
      const execute = vi.fn().mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: "",
        exitCode: 0,
      });
      await expect(
        readMaintenancePr("candidate", {}, execute),
      ).rejects.toThrow();
    },
  );

  test("distinguishes no PR from an existing draft", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([pr]),
        stderr: "",
        exitCode: 0,
      });
    expect(await readMaintenancePr("candidate", {}, execute)).toBeUndefined();
    expect(await readMaintenancePr("candidate", {}, execute)).toEqual(pr);
  });

  test("promotion starts in an empty workspace without installing dependencies", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ci-promotion-bootstrap-"),
    );
    try {
      const result = await Bun.build({
        entrypoints: [
          fileURLToPath(
            new URL(
              "../../ci/scripts/images/update-ci-image-pin.ts",
              import.meta.url,
            ),
          ),
        ],
        packages: "external",
        target: "bun",
      });
      expect(result.success).toBe(true);
      const artifact = result.outputs[0];
      if (artifact === undefined) throw new Error("Missing promotion bundle");
      const entry = path.join(directory, "promotion.js");
      await Bun.write(entry, artifact);
      const child = Bun.spawn(["bun", "--no-install", entry], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit).toBe(1);
      expect(stdout + stderr).toContain("Usage: update-ci-image-pin.ts");
      expect(stdout + stderr).not.toContain("Cannot find package");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
