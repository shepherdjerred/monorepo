import { getRunLogs } from "@shepherdjerred/tools/lib/github/ci.ts";

export type LogsOptions = {
  repo?: string | undefined;
  failedOnly?: boolean | undefined;
  job?: string | undefined;
};

export async function logsCommand(
  runId: string,
  options: LogsOptions = {},
): Promise<void> {
  if (!runId) {
    console.error("Error: Run ID is required");
    console.error(
      "Usage: tools pr logs <run-id> [--failed-only] [--job <name>]",
    );
    process.exit(1);
  }

  const logs = await getRunLogs(runId, options.repo, {
    failedOnly: options.failedOnly,
    jobName: options.job,
  });

  console.log(logs);
}
