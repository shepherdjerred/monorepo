import type { TServiceParams } from "@digital-alchemy/core";
import { shouldStartCleaning, withTimeout } from "../util.ts";
import { instrumentWorkflow } from "../metrics.ts";

export function runVacuumIfNotHome({ hass, scheduler, logger }: TServiceParams) {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const roomba = hass.refBy.id("vacuum.roomba");

  function isEveryoneAway() {
    return personJerred.state === "not_home" && personShuxin.state === "not_home";
  }

  scheduler.cron({
    schedule: ["0 9 * * *", "0 12 * * *", "0 17 * * *"], // 9 AM, 12 PM, 5 PM
    exec: async () => {
      await instrumentWorkflow("run_vacuum_if_not_home", async () => {
        await withTimeout(
          (async () => {
            logger.info("Run Vacuum if Not Home automation triggered");

            logger.debug("Checking conditions for vacuum execution");
            if (isEveryoneAway()) {
              if (shouldStartCleaning(roomba.state)) {
                logger.debug("Conditions met; starting Roomba");

                await hass.call.notify.notify({
                  title: "Vacuum Started",
                  message: "The Roomba has started cleaning since no one is home.",
                });

                await roomba.start();
              }
            }
          })(),
          { amount: 2, unit: "m" },
          "run_vacuum_if_not_home workflow",
        );
      });
    },
  });
}
