import type { TServiceParams } from "@digital-alchemy/core";
import {
  isAnyoneHome,
  runIf,
  withTimeout,
} from "@shepherdjerred/homelab/ha/src/util.ts";
import { instrumentWorkflow } from "@shepherdjerred/homelab/ha/src/metrics.ts";
import {
  isPcGeneratingHeat,
  setAwayMode,
  setBedtimeMode,
  setClimateZones,
  setHomeComfortMode,
  TEMP_BEDTIME,
  TEMP_DEEP_SLEEP,
  TEMP_PRE_WAKE,
} from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

export function climateControl({ hass, scheduler, logger }: TServiceParams) {
  const officeHeater = hass.refBy.id("climate.office_thermostat");

  /**
   * Periodic PC heat check - Monitor PC power and adjust office heating
   * Runs every 5 minutes to respond to PC usage changes
   */
  scheduler.cron({
    schedule: "*/5 * * * *",
    exec: () =>
      instrumentWorkflow("climate_pc_heat_check", async () => {
        await withTimeout(
          runIf(isAnyoneHome(hass), async () => {
            const pcGeneratingHeat = isPcGeneratingHeat(hass, logger);

            if (pcGeneratingHeat) {
              logger.debug(
                "PC generating heat - ensuring office heating is off",
              );
              try {
                await withTimeout(
                  hass.call.climate.turn_off({
                    entity_id: officeHeater.entity_id,
                  }),
                  { amount: 30, unit: "s" },
                  "climate.turn_off office",
                );
              } catch {
                logger.debug("Failed to turn off office heater");
              }
            } else {
              logger.debug(
                "PC not generating heat - office heating may be needed",
              );
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
          runIf(isAnyoneHome(hass), async () => {
            logger.info(
              "Setting bedtime climate - comfortable for falling asleep",
            );
            await setClimateZones(hass, logger, TEMP_BEDTIME, TEMP_BEDTIME);
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
          runIf(isAnyoneHome(hass), async () => {
            logger.info("Setting deep sleep climate - cooler for better sleep");
            await setClimateZones(
              hass,
              logger,
              TEMP_DEEP_SLEEP,
              TEMP_DEEP_SLEEP,
            );
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
          runIf(isAnyoneHome(hass), async () => {
            logger.info(
              "Pre-wake heating for weekday - warming house before wake time",
            );
            await setClimateZones(hass, logger, TEMP_PRE_WAKE, TEMP_PRE_WAKE);
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
          runIf(isAnyoneHome(hass), async () => {
            logger.info(
              "Pre-wake heating for weekend - warming house before wake time",
            );
            await setClimateZones(hass, logger, TEMP_PRE_WAKE, TEMP_PRE_WAKE);
          }),
          { amount: 2, unit: "m" },
          "climate_pre_wake_weekend",
        );
      }),
  });

  return {
    setAwayMode: () => setAwayMode(hass, logger),
    setHomeComfortMode: () => setHomeComfortMode(hass, logger),
    setBedtimeMode: () => setBedtimeMode(hass, logger),
  };
}
