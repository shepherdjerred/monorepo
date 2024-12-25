import * as Sentry from "https://deno.land/x/sentry/index.mjs";

Sentry.init({
  dsn: configuration.sentryDsn,
  environment: configuration.environment,
  release: configuration.gitSha,
});

import "./db/index.ts";
import "./discord/index.ts";
import { startCronJobs } from "./league/cron.ts";
import "./server/index.ts";
import configuration from "./configuration.ts";

startCronJobs();
