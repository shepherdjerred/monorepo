import type { TServiceParams } from "@digital-alchemy/core";
import { z } from "zod";
import { runParallel, verifyAfterDelay, withTimeout } from "./util.ts";

// ============================================================================
// SEASONAL TEMPERATURE CONFIGURATION - WINTER
// ============================================================================
// Adjust these constants for different seasons:
// - Winter: Focus on heating, comfortable temps
// - Spring/Fall: Lower setpoints, more moderate
// - Summer: Focus on cooling (or disable heating entirely)
//
// NOTE: Office/bedroom heating is automatically disabled when PC is generating
// heat (>150W) to save energy and avoid overheating.
// ============================================================================

// Winter temperature setpoints (in Celsius)
const WINTER_TEMP_HOME_COMFORT = 22; // When home and awake
const WINTER_TEMP_AWAY = 20; // Energy saving when away
const WINTER_TEMP_BEDTIME = 22; // Comfortable for falling asleep
const WINTER_TEMP_DEEP_SLEEP = 22; // Cooler during deep sleep
const WINTER_TEMP_PRE_WAKE = 22; // Warm before waking

// Active configuration (change these for seasonal adjustments)
export const TEMP_HOME_COMFORT = WINTER_TEMP_HOME_COMFORT;
export const TEMP_AWAY = WINTER_TEMP_AWAY;
export const TEMP_BEDTIME = WINTER_TEMP_BEDTIME;
export const TEMP_DEEP_SLEEP = WINTER_TEMP_DEEP_SLEEP;
export const TEMP_PRE_WAKE = WINTER_TEMP_PRE_WAKE;

// PC power threshold - skip bedroom heating when PC generates heat (watts)
const PC_HEAT_THRESHOLD = 150;

/**
 * Generation counter for climate changes. Incremented on each setClimateZones
 * call. DSC closures capture the generation at schedule time and skip
 * verification if a newer climate change has been issued since.
 */
let climateGeneration = 0;

/**
 * Check if PC is generating significant heat.
 * Returns true if PC power usage exceeds threshold.
 */
export function isPcGeneratingHeat(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
): boolean {
  try {
    const pcPowerSensor = hass.refBy.id(
      "sensor.sonoff_desktop_pc002166152_power",
    );
    const parseResult = z.number().safeParse(pcPowerSensor.state);

    if (!parseResult.success) {
      logger.debug(
        "PC power sensor returned invalid value, assuming no heat generation",
      );
      return false;
    }

    const powerUsage = parseResult.data;
    const isGeneratingHeat = powerUsage > PC_HEAT_THRESHOLD;

    if (isGeneratingHeat) {
      logger.debug(
        `PC generating heat: ${powerUsage.toFixed(1)}W (threshold: ${PC_HEAT_THRESHOLD.toString()}W) - skipping bedroom heating`,
      );
    }

    return isGeneratingHeat;
  } catch {
    logger.debug("PC power sensor unavailable, assuming no heat generation");
    return false;
  }
}

/**
 * Set temperature for all climate zones.
 * Safely handles cases where entities might not exist.
 * Skips office heating when PC is generating significant heat.
 */
export async function setClimateZones(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
  bedroomTemp: number,
  officeTemp: number,
) {
  const generation = ++climateGeneration;

  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  const officeHeater = hass.refBy.id("climate.office_thermostat");

  const tasks: (() => Promise<unknown>)[] = [];

  tasks.push(() =>
    withTimeout(
      hass.call.climate.set_temperature({
        entity_id: bedroomHeater.entity_id,
        hvac_mode: "heat",
        temperature: bedroomTemp,
      }),
      { amount: 30, unit: "s" },
      "climate.set_temperature bedroom",
    ),
  );

  const pcHot = isPcGeneratingHeat(hass, logger);
  if (pcHot) {
    logger.info(`Skipping office heating - PC is generating sufficient heat`);
  } else {
    tasks.push(() =>
      withTimeout(
        hass.call.climate.set_temperature({
          entity_id: officeHeater.entity_id,
          hvac_mode: "heat",
          temperature: officeTemp,
        }),
        { amount: 30, unit: "s" },
        "climate.set_temperature office",
      ),
    );
  }

  await runParallel(tasks);

  verifyAfterDelay({
    entityId: bedroomHeater.entity_id,
    workflowName: "climate_bedroom",
    getActualState: () => {
      if (climateGeneration !== generation) {
        return bedroomTemp.toString();
      }
      return String(bedroomHeater.attributes.temperature);
    },
    check: (actual) => actual === bedroomTemp.toString(),
    delay: { amount: 30, unit: "s" },
    retries: 2,
    retryDelay: { amount: 15, unit: "s" },
    description: `target ${bedroomTemp.toString()}°C`,
    logger,
    hass,
  });

  if (!pcHot) {
    verifyAfterDelay({
      entityId: officeHeater.entity_id,
      workflowName: "climate_office",
      getActualState: () => {
        if (climateGeneration !== generation) {
          return officeTemp.toString();
        }
        return String(officeHeater.attributes.temperature);
      },
      check: (actual) => actual === officeTemp.toString(),
      delay: { amount: 30, unit: "s" },
      retries: 2,
      retryDelay: { amount: 15, unit: "s" },
      description: `target ${officeTemp.toString()}°C`,
      logger,
      hass,
    });
  }
}

export async function setAwayMode(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
) {
  logger.info("Setting climate to away mode - energy saving");
  await setClimateZones(hass, logger, TEMP_AWAY, TEMP_AWAY);
}

export async function setHomeComfortMode(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
) {
  logger.info("Setting climate to home comfort mode");
  await setClimateZones(hass, logger, TEMP_HOME_COMFORT, TEMP_HOME_COMFORT);
}

export async function setBedtimeMode(
  hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
) {
  logger.info("Setting climate to bedtime mode");
  await setClimateZones(hass, logger, TEMP_BEDTIME, TEMP_BEDTIME);
}
