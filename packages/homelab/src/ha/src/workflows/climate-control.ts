import type { TServiceParams } from "@digital-alchemy/core";
import {
  setAwayMode,
  setBedtimeMode,
  setHomeComfortMode,
} from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

/**
 * Climate control workflow.
 * Currently a no-op — thermostats have been removed from HA.
 * The scheduler crons and logic will be restored when new thermostats are added.
 */
export function climateControl({ hass, logger }: TServiceParams) {
  return {
    setAwayMode: () => setAwayMode(hass, logger),
    setHomeComfortMode: () => setHomeComfortMode(hass, logger),
    setBedtimeMode: () => setBedtimeMode(hass, logger),
  };
}
