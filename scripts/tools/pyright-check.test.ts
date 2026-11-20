import { expect, test } from "vitest";
import { z } from "zod";

import { PYRIGHT_VERSION } from "../misc/migration-core.ts";

const RenovateSchema = z.object({
  customManagers: z.array(
    z.object({
      description: z.string(),
      matchStrings: z.array(z.string()),
    }),
  ),
});

test("Pyright is pinned for deterministic repository checks", () => {
  expect(PYRIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("Renovate matches TypeScript version annotations", async () => {
  const renovate = RenovateSchema.parse(
    await Bun.file(`${import.meta.dir}/../../renovate.json`).json(),
  );
  const manager = renovate.customManagers.find((candidate) =>
    candidate.description.startsWith("Hinted version pins"),
  );
  if (manager === undefined) {
    throw new Error("Hinted version pin Renovate manager is missing");
  }
  const expression = manager.matchStrings[0];
  if (expression === undefined) {
    throw new Error("Hinted version pin matcher is missing");
  }
  const example = `// renovate: datasource=npm depName=pyright\nexport const PYRIGHT_VERSION = "${PYRIGHT_VERSION}";`;
  const match = new RegExp(expression).exec(example);
  expect(match?.groups?.["datasource"]).toBe("npm");
  expect(match?.groups?.["depName"]).toBe("pyright");
  expect(match?.groups?.["currentValue"]).toBe(PYRIGHT_VERSION);
});
