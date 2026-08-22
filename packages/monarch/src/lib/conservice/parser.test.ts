import { describe, expect, test } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadConserviceFromPdfs } from "./parser.ts";

describe("loadConserviceFromPdfs", () => {
  test("returns an empty list when the PDF directory is missing", async () => {
    const missingDir = path.join(
      tmpdir(),
      `missing-conservice-${crypto.randomUUID()}`,
    );

    await expect(loadConserviceFromPdfs(missingDir)).resolves.toEqual([]);
  });
});
