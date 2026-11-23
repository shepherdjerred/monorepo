import type { ReplaySession } from "@scout-for-lol/replay";

/** A newer scrub owns presentation; cancellation must not retire its session. */
export async function runReplayCommand(
  current: () => ReplaySession | null,
  action: (active: ReplaySession) => void | Promise<void>,
  onFailure: (error: unknown, active: ReplaySession) => void,
): Promise<void> {
  const active = current();
  if (active === null) return;
  try {
    await action(active);
  } catch (error_) {
    if (current() !== active) return;
    if (error_ instanceof DOMException && error_.name === "AbortError") return;
    onFailure(error_, active);
  }
}
