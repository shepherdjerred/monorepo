import { getStacktrace } from "#lib/bugsink/queries.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type StacktraceOptions = {
  json?: boolean | undefined;
};

export async function stacktraceCommand(
  eventUuid: string,
  options: StacktraceOptions = {},
): Promise<void> {
  try {
    const stacktrace = await getStacktrace(eventUuid);

    if (options.json === true) {
      console.log(formatJson({ stacktrace }));
    } else {
      console.log("## Stacktrace");
      console.log("");
      console.log(stacktrace);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
