export type SynchronousFileSinkWriter = (
  sink: Bun.FileSink,
  line: string,
) => void;

async function reportAsynchronousFailure(
  result: Promise<number>,
): Promise<void> {
  try {
    await result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Run event sink failed after entering asynchronous backpressure: ${message}\n`,
    );
  }
}

function requireSynchronousResult(
  result: number | Promise<number>,
  operation: string,
): void {
  if (result instanceof Promise) {
    void reportAsynchronousFailure(result);
    throw new Error(
      `Run event ${operation} entered asynchronous backpressure; refusing to continue without durable capture`,
    );
  }
}

export const writeFileSinkSynchronously: SynchronousFileSinkWriter = (
  sink,
  line,
) => {
  requireSynchronousResult(sink.write(line), "write");
  requireSynchronousResult(sink.flush(), "flush");
};
