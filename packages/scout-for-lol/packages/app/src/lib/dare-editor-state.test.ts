import { describe, expect, test } from "vitest";
import { dareEditorInstanceKey } from "#src/lib/dare-editor-state.ts";

describe("Dare editor instance state", () => {
  test("changes the editor instance when the fetched revision changes", () => {
    expect(dareEditorInstanceKey({ id: 7, currentRevision: 1 })).not.toBe(
      dareEditorInstanceKey({ id: 7, currentRevision: 2 }),
    );
  });

  test("changes the editor instance when another dare is selected", () => {
    expect(dareEditorInstanceKey({ id: 7, currentRevision: 1 })).not.toBe(
      dareEditorInstanceKey({ id: 8, currentRevision: 1 }),
    );
  });
});
