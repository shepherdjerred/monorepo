import { describe, expect, it } from "vitest";
import {
  entityIdMatchesGlob,
  isExpectedUnavailable,
  loadConfig,
  parseEntities,
  UNAVAILABLE_IGNORED_ENTITY_GLOBS,
} from "../config.ts";
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
    expect(config.homeAssistant.unavailableIgnoredDomains).toContain(
      "conversation",
    );
    expect(config.homeAssistant.unavailableIgnoredEntityGlobs).toEqual(
      UNAVAILABLE_IGNORED_ENTITY_GLOBS,
    );
    expect(UNAVAILABLE_IGNORED_ENTITY_GLOBS).toContain("media_player.rooftop");
    expect(UNAVAILABLE_IGNORED_ENTITY_GLOBS).toContain("sensor.ipad_*");
  });

  it("treats companion diagnostics and portable speakers as expected gaps", () => {
    expect(entityIdMatchesGlob("sensor.ipad_2_ssid", "sensor.ipad_*")).toBe(
      true,
    );
    expect(
      entityIdMatchesGlob("media_player.bedroom", "media_player.rooftop"),
    ).toBe(false);
    expect(
      isExpectedUnavailable(
        "media_player.rooftop",
        [],
        ["media_player.rooftop"],
      ),
    ).toBe(true);
    expect(
      isExpectedUnavailable("climate.bedroom", ["scene"], ["sensor.ipad_*"]),
    ).toBe(false);
    expect(
      isExpectedUnavailable(
        "conversation.home_assistant",
        ["conversation"],
        [],
      ),
    ).toBe(true);
  });

  it("accepts port zero for an OS-assigned listener", () => {
    const config = loadConfig({
      PORT: "0",
      TRMNL_API_KEY: "secret",
      HA_TOKEN: "ha-token",
    });

    expect(config.port).toBe(0);
  });
});

describe("worstStatus", () => {
  it("returns the highest severity", () => {
    expect(worstStatus(["ok", "warning", "unknown"])).toBe("warning");
    expect(worstStatus(["ok", "error", "warning"])).toBe("error");
  });
});
