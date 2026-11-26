import { describe, expect, it } from "vitest";
import { flagValueJsonSchemas } from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { themeCatalog } from "@shepherdjerred/storm-theme";

describe("storm-forum-season value schema", () => {
  it("allows exactly auto plus every storm-theme catalog id", () => {
    const schema = flagValueJsonSchemas()["storm-forum-season"]?.schema;
    expect(schema?.["enum"]).toEqual([
      "auto",
      ...themeCatalog.themes.map(({ id }) => id),
    ]);
  });
});
