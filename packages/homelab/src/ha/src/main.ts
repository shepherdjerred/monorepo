// Sentry must be initialized first to capture all errors
import "./sentry.ts";

import { goodMorning } from "./workflows/good-morning.ts";
import { goodNight } from "./workflows/good-night.ts";
import { welcomeHome } from "./workflows/welcome-home.ts";
import { runVacuumIfNotHome } from "./workflows/run-vacuum-if-not-home.ts";
import { leavingHome } from "./workflows/leaving-home.ts";
import { climateControl } from "./workflows/climate-control.ts";
import { startMetricsServer } from "./metrics-server.ts";

import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_SYNAPSE } from "@digital-alchemy/synapse";
import { LIB_AUTOMATION } from "@digital-alchemy/automation";
import { CreateApplication } from "@digital-alchemy/core";

const app = CreateApplication({
  libraries: [LIB_HASS, LIB_SYNAPSE, LIB_AUTOMATION],
  name: "automation",
  services: {
    metricsServer: startMetricsServer,
    goodMorning,
    goodNight,
    welcomeHome,
    runVacuumIfNotHome,
    leavingHome,
    climateControl,
  },
});

await app.bootstrap();
