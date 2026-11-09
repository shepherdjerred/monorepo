import { WOODPECKER_RETENTION_SCHEDULE } from "./woodpecker-retention-schedule.ts";
import { CI_MAINTENANCE_SCHEDULE } from "./ci-maintenance-schedule.ts";
import { CI_WORKSPACE_REAPER_SCHEDULE } from "./ci-workspace-reaper-schedule.ts";
import { CI_EXTENDED_VERIFY_SCHEDULE } from "./ci-extended-verify-schedule.ts";

export const CI_SCHEDULES = [
  WOODPECKER_RETENTION_SCHEDULE,
  CI_MAINTENANCE_SCHEDULE,
  CI_WORKSPACE_REAPER_SCHEDULE,
  CI_EXTENDED_VERIFY_SCHEDULE,
];
