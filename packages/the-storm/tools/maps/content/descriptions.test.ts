import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import descriptions from "./descriptions.json";
import { mapDescription } from "./descriptions.ts";
import { MapContent } from "#learning/maps/scenario.ts";

describe("authored map descriptions", () => {
  it("requires an explicit catalog entry for a new legacy import", () => {
    expect(() => mapDescription("missing-new-map")).toThrow(
      "Missing authored map description",
    );
  });

  it("keeps every imported map's shipped description equal to its authored import input", async () => {
    const ids = z.array(z.string()).parse(Object.keys(descriptions));
    expect(ids).toHaveLength(33);
    for (const id of ids) {
      const file = path.resolve(
        import.meta.dir,
        "../../../server/owned/plugins/TheStorm/rwf/maps",
        id,
        "map.yml",
      );
      const map = MapContent.parse(Bun.YAML.parse(await Bun.file(file).text()));
      expect(map.description).toBe(mapDescription(id));
      expect(map.description).not.toBe("null");
    }
  });
});
