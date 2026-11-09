/** Terminate this isolated daemon if its writer disappears, cancelling SDK queues. */
const abort = () => process.exit(1);

export async function withinDiscordCaller(
  request: Request,
  operation: () => Promise<Response>,
) {
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) abort();
    return await operation();
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}
