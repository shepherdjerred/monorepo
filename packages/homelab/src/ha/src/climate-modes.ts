import type { TServiceParams } from "@digital-alchemy/core";
import { z } from "zod";

// ============================================================================
// SEASONAL TEMPERATURE CONFIGURATION
// ============================================================================
// NOTE: Climate zone thermostats (bedroom/office) have been removed from HA.
// These constants and functions are retained for when new thermostats are added.
// The PC heat detection remains functional for other automations.
// ============================================================================

// PC power threshold - skip bedroom heating when PC generates heat (watts)
const PC_HEAT_THRESHOLD = 150;

// Temperature setpoints (exported for use in climate-control scheduler)
export const TEMP_HOME_COMFORT = 22;
export const TEMP_AWAY = 20;
export const TEMP_BEDTIME = 22;
export const TEMP_DEEP_SLEEP = 22;
export const TEMP_PRE_WAKE = 22;

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
        `PC generating heat: ${powerUsage.toFixed(1)}W (threshold: ${PC_HEAT_THRESHOLD.toString()}W)`,
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
 * Currently a no-op — thermostats have been removed from HA.
 */
export async function setClimateZones(
  _hass: TServiceParams["hass"],
  logger: TServiceParams["logger"],
  _bedroomTemp: number,
  _officeTemp: number,
): Promise<void> {
  logger.debug(
    "Climate zone control is disabled — no thermostats configured in HA",
  );
  await Promise.resolve();
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
