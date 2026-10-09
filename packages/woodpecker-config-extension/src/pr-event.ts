/** Only the ready transition expands metadata into full PR verification. */
export function isPrVerificationEvent(pipeline: {
  readonly event: string;
  readonly event_reason?: readonly string[] | null | undefined;
  readonly pr_draft?: boolean | undefined;
}): boolean {
  return (
    pipeline.event === "pull_request" ||
    (pipeline.event === "pull_request_metadata" &&
      pipeline.pr_draft !== true &&
      pipeline.event_reason?.includes("ready_for_review") === true)
  );
}

export function prStatusEvent(
  event: string,
): "pull_request" | "pull_request_metadata" {
  if (event === "pull_request" || event === "pull_request_metadata")
    return event;
  throw new Error(`No PR completion context for event ${event}`);
}
