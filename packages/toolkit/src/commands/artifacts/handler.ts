import { EXIT } from "#lib/artifacts/errors.ts";
import { artifactsCommand } from "./index.ts";
import { defaultRuntime } from "./runtime.ts";

/**
 * `toolkit artifacts <command>`. SIGINT and SIGTERM abort the running wait or
 * upload and exit 130 or 143.
 */
export async function handleArtifactsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  const controller = new AbortController();
  const received = { code: 0 };
  const onSignal = (code: number) => () => {
    received.code = code;
    controller.abort();
  };
  const interrupt = onSignal(EXIT.sigint);
  const terminate = onSignal(EXIT.sigterm);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    const code = await artifactsCommand(
      subcommand,
      args,
      defaultRuntime({
        signal: controller.signal,
        interruptExit: () => received.code || EXIT.sigint,
      }),
    );
    // A wait leaves its stream and timers behind; exit once output is flushed.
    process.exit(code);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}
