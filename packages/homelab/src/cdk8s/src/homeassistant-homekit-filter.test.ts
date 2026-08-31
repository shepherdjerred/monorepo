import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const HomeKitConfigurationSchema = z.object({
  homekit: z.array(
    z.object({
      name: z.string(),
      filter: z.unknown(),
    }),
  ),
});

const HomeKitFilterSchema = z.object({
  include_entities: z.array(z.string()),
  exclude_entities: z.array(z.string()),
  exclude_entity_globs: z.array(z.string()),
});

async function ha1Filter() {
  const configurationPath = path.join(
    import.meta.dir,
    "../config/homeassistant/configuration.yaml",
  );
  const configuration = HomeKitConfigurationSchema.parse(
    parseYaml(await Bun.file(configurationPath).text(), {
      customTags: [{ tag: "!include", resolve: (value: string) => value }],
    }),
  );
  const bridge = configuration.homekit.find(({ name }) => name === "HA1");
  if (!bridge) {
    throw new Error(
      "Home Assistant configuration must define the HA1 HomeKit bridge",
    );
  }
  return HomeKitFilterSchema.parse(bridge.filter);
}

describe("HA1 HomeKit filter", () => {
  test("does not expose phone or tablet trackers", async () => {
    const filter = await ha1Filter();

    expect(filter.include_entities).toContain("lock.front_door");
    expect(
      filter.include_entities.some((entity) =>
        entity.startsWith("device_tracker."),
      ),
    ).toBe(false);
    expect(filter.exclude_entity_globs).toEqual(
      expect.arrayContaining([
        "binary_sensor.*_camera_motion",
        "binary_sensor.*_kiosk_mode",
      ]),
    );
  });

  test("keeps Sonoff controls and telemetry out of HomeKit", async () => {
    const filter = await ha1Filter();

    expect(filter.exclude_entities).toEqual(
      expect.arrayContaining(["switch.jobs", "switch.office_left_blinds"]),
    );
    expect(filter.exclude_entity_globs).toEqual(
      expect.arrayContaining([
        "binary_sensor.sonoff_*",
        "sensor.sonoff_*",
        "switch.sonoff_*",
      ]),
    );
  });
});
