import { describe, expect, test } from "bun:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadUsaaStatements } from "./parser.ts";

describe("loadUsaaStatements", () => {
  test("returns an empty list when the PDF directory is missing", async () => {
    const missingDir = path.join(
      tmpdir(),
      `missing-usaa-${crypto.randomUUID()}`,
    );

    await expect(loadUsaaStatements(missingDir)).resolves.toEqual([]);
  });
});
