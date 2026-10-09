import { WOODPECKER_RETENTION_SCHEDULE } from "./woodpecker-retention-schedule.ts";
import { CI_MAINTENANCE_SCHEDULE } from "./ci-maintenance-schedule.ts";

export const CI_SCHEDULES = [
  WOODPECKER_RETENTION_SCHEDULE,
  CI_MAINTENANCE_SCHEDULE,
];
