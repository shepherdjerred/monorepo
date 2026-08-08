import { describe, expect, test } from "bun:test";

import { createDefaultSavedViewPreferences } from "../../domain/saved-views";
import { definitionFromSavedView } from "./saved-view-editor-model";

describe("saved-view editor model", () => {
  test("starts a new view with an empty editable name", () => {
    expect(definitionFromSavedView(null).name).toBe("");
  });

  test("preserves the persisted name while editing", () => {
    const existing = createDefaultSavedViewPreferences().views[0];
    if (existing === undefined) throw new Error("expected a default view");

    expect(definitionFromSavedView(existing).name).toBe(existing.name);
  });
});
