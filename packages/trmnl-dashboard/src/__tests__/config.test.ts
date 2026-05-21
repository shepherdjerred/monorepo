import { describe, expect, it } from "bun:test";
import { loadConfig, parseEntities } from "../config.ts";
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

describe("loadConfig", () => {
  it("defaults service-specific dashboard configuration", () => {
    const config = loadConfig({
      TRMNL_API_KEY: "secret",
      HA_TOKEN: "ha-token",
    });

    expect(config.displayTimeZone).toBe("America/Los_Angeles");
    expect(config.homelab.bugsinkUrl).toBe(
      "http://bugsink-bugsink-service.bugsink:8000/api/canonical/0",
    );
    expect(config.homeAssistant.unavailableIgnoredDomains).toContain("scene");
  });
});

describe("worstStatus", () => {
  it("returns the highest severity", () => {
    expect(worstStatus(["ok", "warning", "unknown"])).toBe("warning");
    expect(worstStatus(["ok", "error", "warning"])).toBe("error");
  });
});
