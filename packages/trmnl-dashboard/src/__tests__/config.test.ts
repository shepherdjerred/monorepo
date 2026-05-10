import { describe, expect, it } from "bun:test";
import { parseEntities } from "../config.ts";
import { worstStatus } from "../status.ts";

describe("parseEntities", () => {
  it("parses entity labels", () => {
    expect(parseEntities("person.jerred:Jerred,lock.front:Front Door")).toEqual(
      [
        { entityId: "person.jerred", label: "Jerred" },
        { entityId: "lock.front", label: "Front Door" },
      ],
    );
  });

  it("defaults labels to entity ids", () => {
    expect(parseEntities("binary_sensor.front_door")).toEqual([
      {
        entityId: "binary_sensor.front_door",
        label: "binary_sensor.front_door",
      },
    ]);
  });
});

describe("worstStatus", () => {
  it("returns the highest severity", () => {
    expect(worstStatus(["ok", "warning", "unknown"])).toBe("warning");
    expect(worstStatus(["ok", "error", "warning"])).toBe("error");
  });
});
