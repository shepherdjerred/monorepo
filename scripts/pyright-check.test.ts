import { expect, test } from "bun:test";
import { z } from "zod";

import { PYRIGHT_VERSION } from "./migration-core.ts";

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
    await Bun.file(`${import.meta.dir}/../renovate.json`).json(),
  );
  const manager = renovate.customManagers.find((candidate) =>
    candidate.description.startsWith("Version pins in TypeScript scripts"),
  );
  if (manager === undefined) {
    throw new Error("TypeScript version-pin Renovate manager is missing");
  }
  const examples = [
    `// renovate: datasource=npm depName=pyright\nexport const PYRIGHT_VERSION = "${PYRIGHT_VERSION}";`,
    "// renovate: datasource=npm depName=example\nexample:1.2.3",
  ];
  expect(manager.matchStrings).toHaveLength(examples.length);
  for (const [index, expression] of manager.matchStrings.entries()) {
    const example = examples[index];
    if (example === undefined) {
      throw new Error(
        `Missing Renovate example for expression ${index.toString()}`,
      );
    }
    const match = new RegExp(expression, "m").exec(example);
    expect(match?.groups?.["currentValue"]).toBe(
      index === 0 ? PYRIGHT_VERSION : "1.2.3",
    );
  }
});
