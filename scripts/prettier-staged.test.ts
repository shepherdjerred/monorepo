import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";

import { existingFiles } from "./migration-core.ts";

test("existingFiles omits missing paths while preserving input order", async () => {
  const currentFile = fileURLToPath(import.meta.url);
  expect(await existingFiles([currentFile, `${currentFile}.missing`])).toEqual([
    currentFile,
  ]);
});
