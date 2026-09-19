import { describe, expect, test } from "vitest";
import { normalizeItemEvent } from "./items.ts";

describe("Codex App Server item normalization", () => {
  test("parses file-change kinds from the protocol string enum", () => {
    expect(
      normalizeItemEvent("item/completed", {
        id: "file-change",
        type: "fileChange",
        changes: [
          { path: "added.ts", kind: "add" },
          { path: "updated.ts", kind: "update" },
          { path: "deleted.ts", kind: "delete" },
        ],
        status: "completed",
      }),
    ).toEqual({
      type: "item.completed",
      item: {
        id: "file-change",
        type: "file_change",
        changes: [
          { path: "added.ts", kind: "add" },
          { path: "updated.ts", kind: "update" },
          { path: "deleted.ts", kind: "delete" },
        ],
        status: "completed",
      },
    });
  });
});
