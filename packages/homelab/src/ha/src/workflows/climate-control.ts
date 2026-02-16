import type { TServiceParams } from "@digital-alchemy/core";
import { runIf, runParallel, withTimeout } from "../util.ts";
import { instrumentWorkflow } from "../metrics.ts";
import { z } from "zod";

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
// TODO: Re-enable when living room thermostat is back online
// const WINTER_TEMP_LIVING_ROOM_SLEEP = 22; // Living room during sleep hours

// Active configuration (change these for seasonal adjustments)
const TEMP_HOME_COMFORT = WINTER_TEMP_HOME_COMFORT;
const TEMP_AWAY = WINTER_TEMP_AWAY;
const TEMP_BEDTIME = WINTER_TEMP_BEDTIME;
const TEMP_DEEP_SLEEP = WINTER_TEMP_DEEP_SLEEP;
const TEMP_PRE_WAKE = WINTER_TEMP_PRE_WAKE;
// TODO: Re-enable when living room thermostat is back online
// const TEMP_LIVING_ROOM_SLEEP = WINTER_TEMP_LIVING_ROOM_SLEEP;

// PC power threshold - skip bedroom heating when PC generates heat (watts)
const PC_HEAT_THRESHOLD = 150;

export function climateControl({ hass, scheduler, logger }: TServiceParams) {
  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  const officeHeater = hass.refBy.id("climate.office_thermostat");
  // TODO: Re-enable when living room thermostat is back online
  // const livingRoomClimate = hass.refBy.id("climate.living_room");
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const pcPowerSensor = hass.refBy.id("sensor.sonoff_desktop_pc002166152_power");

  function isAnyoneHome() {
    return personJerred.state === "home" || personShuxin.state === "home";
  }

  /**
   * Check if PC is generating significant heat
   * Returns true if PC power usage exceeds threshold
   */
  function isPcGeneratingHeat(): boolean {
    try {
      // Parse and validate sensor state as a number
      const parseResult = z.number().safeParse(pcPowerSensor.state);

      if (!parseResult.success) {
        logger.debug("PC power sensor returned invalid value, assuming no heat generation");
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
   * Helper function to set temperature for all climate zones
   * Safely handles cases where entities might not exist
   * Skips office heating when PC is generating significant heat
   */
  // Note: livingRoomTemp parameter removed until thermostat is back online
  async function setClimateZones(bedroomTemp: number, officeTemp: number) {
    const tasks: (() => Promise<unknown>)[] = [];

    // Always set bedroom temperature (bedroom is separate from office)
    tasks.push(() =>
      hass.call.climate.set_temperature({
        entity_id: bedroomHeater.entity_id,
        hvac_mode: "heat",
        temperature: bedroomTemp,
      }),
    );

    // Set office temperature only if PC isn't generating heat
    // PC generates 2-3°C of warmth in the office, making additional heating unnecessary
    if (!isPcGeneratingHeat()) {
      tasks.push(() =>
        hass.call.climate.set_temperature({
          entity_id: officeHeater.entity_id,
          hvac_mode: "heat",
          temperature: officeTemp,
        }),
      );
    } else {
      logger.info(`Skipping office heating - PC is generating sufficient heat`);
    }

    // TODO: Re-enable when living room thermostat is back online
    // Set living room if entity exists and is available
    // try {
    //   tasks.push(() =>
    //     livingRoomClimate.set_temperature({
    //       hvac_mode: "heat",
    //       temperature: livingRoomTemp,
    //     }),
    //   );
    // } catch {
    //   logger.debug("Living room climate not available, skipping");
    // }

    await runParallel(tasks);
  }

  /**
   * Periodic PC heat check - Monitor PC power and adjust office heating
   * Runs every 5 minutes to respond to PC usage changes
   */
  scheduler.cron({
    schedule: "*/5 * * * *",
    exec: () =>
      instrumentWorkflow("climate_pc_heat_check", async () => {
        await withTimeout(
          runIf(isAnyoneHome(), async () => {
            const pcGeneratingHeat = isPcGeneratingHeat();

            // Only adjust office heating based on PC state
            if (pcGeneratingHeat) {
              logger.debug("PC generating heat - ensuring office heating is off");
              try {
                await hass.call.climate.turn_off({ entity_id: officeHeater.entity_id });
              } catch {
                logger.debug("Failed to turn off office heater");
              }
            } else {
              // PC is idle/off, ensure office has appropriate heating for current mode
              logger.debug("PC not generating heat - office heating may be needed");
              // Note: This is a passive check. Active heating is set by time-based schedules.
            }
          }),
          { amount: 1, unit: "m" },
          "climate_pc_heat_check",
        );
      }),
  });

  /**
   * Bedtime prep - Set comfortable sleeping temperature
   * Runs at 9:30 PM every night
   */
  scheduler.cron({
    schedule: "30 21 * * *",
    exec: () =>
      instrumentWorkflow("climate_bedtime_prep", async () => {
        await withTimeout(
          runIf(isAnyoneHome(), async () => {
            logger.info("Setting bedtime climate - comfortable for falling asleep");
            await setClimateZones(TEMP_BEDTIME, TEMP_BEDTIME);
          }),
          { amount: 2, unit: "m" },
          "climate_bedtime_prep",
        );
      }),
  });

  /**
   * Deep sleep - Lower temperature for better sleep
   * Runs at 12:00 AM (midnight) every night
   */
  scheduler.cron({
    schedule: "0 0 * * *",
    exec: () =>
      instrumentWorkflow("climate_deep_sleep", async () => {
        await withTimeout(
          runIf(isAnyoneHome(), async () => {
            logger.info("Setting deep sleep climate - cooler for better sleep");
            await setClimateZones(TEMP_DEEP_SLEEP, TEMP_DEEP_SLEEP);
          }),
          { amount: 2, unit: "m" },
          "climate_deep_sleep",
        );
      }),
  });

  /**
   * Pre-wake heating for weekdays
   * Runs at 6:00 AM Monday-Friday (1 hour before 7am wake time)
   */
  scheduler.cron({
    schedule: "0 6 * * 1-5",
    exec: () =>
      instrumentWorkflow("climate_pre_wake_weekday", async () => {
        await withTimeout(
          runIf(isAnyoneHome(), async () => {
            logger.info("Pre-wake heating for weekday - warming house before wake time");
            await setClimateZones(TEMP_PRE_WAKE, TEMP_PRE_WAKE);
          }),
          { amount: 2, unit: "m" },
          "climate_pre_wake_weekday",
        );
      }),
  });

  /**
   * Pre-wake heating for weekends
   * Runs at 7:00 AM Saturday-Sunday (1 hour before 8am wake time)
   */
  scheduler.cron({
    schedule: "0 7 * * 6,0",
    exec: () =>
      instrumentWorkflow("climate_pre_wake_weekend", async () => {
        await withTimeout(
          runIf(isAnyoneHome(), async () => {
            logger.info("Pre-wake heating for weekend - warming house before wake time");
            await setClimateZones(TEMP_PRE_WAKE, TEMP_PRE_WAKE);
          }),
          { amount: 2, unit: "m" },
          "climate_pre_wake_weekend",
        );
      }),
  });

  /**
   * Exported function for other workflows to set away mode
   */
  async function setAwayMode() {
    logger.info("Setting climate to away mode - energy saving");
    await setClimateZones(TEMP_AWAY, TEMP_AWAY);
  }

  /**
   * Exported function for other workflows to set home comfort mode
   */
  async function setHomeComfortMode() {
    logger.info("Setting climate to home comfort mode");
    await setClimateZones(TEMP_HOME_COMFORT, TEMP_HOME_COMFORT);
  }

  /**
   * Exported function for manual bedtime triggers
   */
  async function setBedtimeMode() {
    logger.info("Setting climate to bedtime mode");
    await setClimateZones(TEMP_BEDTIME, TEMP_BEDTIME);
  }

  return {
    setAwayMode,
    setHomeComfortMode,
    setBedtimeMode,
  };
}
