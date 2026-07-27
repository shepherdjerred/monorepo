import { expect, test } from "bun:test";

import { PYRIGHT_VERSION } from "./migration-core.ts";

test("Pyright is pinned for deterministic repository checks", () => {
  expect(PYRIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
