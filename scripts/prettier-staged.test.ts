import { expect, test } from "bun:test";

import { existingFiles } from "./migration-core.ts";

test("existingFiles omits missing paths while preserving input order", async () => {
  expect(
    await existingFiles([import.meta.path, `${import.meta.path}.missing`]),
  ).toEqual([import.meta.path]);
});
