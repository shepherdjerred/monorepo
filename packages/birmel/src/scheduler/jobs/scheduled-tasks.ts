import { runAgentJobsJob } from "./agent-jobs.ts";

/**
 * Run the scheduled tasks job - checks for and executes due tasks
 */
export async function runScheduledTasksJob(): Promise<void> {
  await runAgentJobsJob();
}
