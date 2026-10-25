import { expect, test } from "vitest";
import path from "node:path";
import { z } from "zod";
import { standaloneScenarioManifest } from "./standalone-contract.ts";

test("standalone porting inventory retains every original assertion exactly once", async () => {
  const root = path.resolve(import.meta.dir, "..");
  const original = z
    .object({
      scenarios: z.array(z.object({ assertions: z.array(z.string()) })),
    })
    .parse(await Bun.file(path.join(root, "e2e/scenarios.json")).json());
  const matrix = z
    .object({
      schemaVersion: z.literal(1),
      runtimeAcceptance: z.literal("unverified"),
      originalAssertions: z.array(
        z.discriminatedUnion("status", [
          z
            .object({
              id: z.string(),
              status: z.literal("contract-pending"),
              reason: z.string().min(10),
            })
            .strict(),
          z
            .object({
              id: z.string(),
              status: z.literal("live-required"),
              scenario: z.string(),
              reason: z.string().min(10),
            })
            .strict(),
          z
            .object({
              id: z.string(),
              status: z.literal("implemented"),
              replacement: z.string(),
            })
            .strict(),
          z
            .object({
              id: z.string(),
              status: z.literal("replaced"),
              reason: z.string().min(10),
              replacement: z.string(),
            })
            .strict(),
        ]),
      ),
      liveScenarios: z.array(
        z.object({ id: z.string(), requirements: z.string().min(50) }).strict(),
      ),
    })
    .strict()
    .parse(
      await Bun.file(path.join(root, "e2e/standalone/porting.json")).json(),
    );
  const expected = original.scenarios
    .flatMap((scenario) => scenario.assertions)
    .sort();
  const actual = matrix.originalAssertions
    .map((assertion) => assertion.id)
    .sort();
  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(actual.length);
  const directory = path.join(root, "tests/TaskNotes.Windows.E2E");
  const files = [
    ...new Bun.Glob("StandaloneProductionScenarios*.cs").scanSync({
      cwd: directory,
    }),
  ];
  const sourceFiles = await Promise.all(
    files.map((file) => Bun.file(path.join(directory, file)).text()),
  );
  const source = sourceFiles.join("\n");
  const manifest = await standaloneScenarioManifest();
  const declared = new Set(Object.values(manifest.scenarios).flat());
  for (const assertion of matrix.originalAssertions) {
    if (assertion.status === "implemented" || assertion.status === "replaced") {
      expect(source).toContain(`"${assertion.replacement}"`);
      expect(declared.has(assertion.replacement)).toBe(true);
    }
    if (assertion.status === "live-required")
      expect(
        matrix.liveScenarios.some(
          (scenario) => scenario.id === assertion.scenario,
        ),
      ).toBe(true);
  }
});
