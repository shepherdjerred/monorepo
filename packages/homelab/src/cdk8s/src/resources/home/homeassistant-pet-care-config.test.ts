import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const PetCareConfigurationSchema = z.object({
  automation: z.unknown().optional(),
  input_boolean: z.unknown().optional(),
  template: z.array(
    z
      .object({
        binary_sensor: z
          .array(
            z.object({
              unique_id: z.string(),
              delay_on: z.unknown().optional(),
            }),
          )
          .optional(),
      })
      .loose(),
  ),
});

const PET_CARE_SENSOR_IDS = [
  "petlibro_fountain_operation_problem",
  "litter_robot_problem",
  "litter_robot_stalled",
  "petlibro_living_room_feeder_problem",
  "petlibro_guest_room_feeder_problem",
  "petlibro_fountain_water_low",
] as const;

describe("Home Assistant pet-care source config", () => {
  test("uses raw custom sensors without automations or HA-owned holds", async () => {
    const configDirectory = path.join(
      import.meta.dir,
      "../../../config/homeassistant",
    );
    const configuration = PetCareConfigurationSchema.parse(
      parseYaml(
        await Bun.file(path.join(configDirectory, "configuration.yaml")).text(),
        {
          customTags: [{ tag: "!include", resolve: (value: string) => value }],
        },
      ),
    );

    expect(configuration.automation).toBeUndefined();
    expect(configuration.input_boolean).toBeUndefined();
    const sensors = configuration.template.flatMap(
      ({ binary_sensor: binarySensor }) => binarySensor ?? [],
    );
    for (const uniqueId of PET_CARE_SENSOR_IDS) {
      const sensor = sensors.find(
        (candidate) => candidate.unique_id === uniqueId,
      );
      expect(sensor, `missing pet-care sensor ${uniqueId}`).toBeDefined();
      expect(
        sensor?.delay_on,
        `${uniqueId} still owns a delay`,
      ).toBeUndefined();
    }
    expect(
      await Bun.file(path.join(configDirectory, "automation.yaml")).exists(),
    ).toBe(false);
  });
});
