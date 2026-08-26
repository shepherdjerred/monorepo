import {
  EXPLORE_ANSWER_MAX_LENGTH,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import { recordExploreTraceEvent } from "#src/explore/trace.ts";
import type { ActiveRun } from "#src/explore/run-manager-types.ts";

export function broadcastExploreEvent(
  run: ActiveRun,
  event: ExploreStreamEvent,
): void {
  for (const subscriber of run.subscribers) {
    try {
      subscriber(event);
    } catch {
      run.subscribers.delete(subscriber);
    }
  }
}

export function recordExploreEvent(
  run: ActiveRun,
  event: ExploreStreamEvent,
): void {
  if (
    event.type === "error" &&
    (run.termination === "stop" || run.termination === "delete")
  ) {
    return;
  }
  if (event.type === "answer_delta") {
    const available = EXPLORE_ANSWER_MAX_LENGTH - run.answer.length;
    if (available <= 0) return;
    const text = event.text.slice(0, available);
    run.answer += text;
    broadcastExploreEvent(run, { type: "answer_delta", text });
    return;
  }
  if (event.type === "tool_call" || event.type === "tool_result") {
    run.activity = event.message;
  }
  recordExploreTraceEvent(run.trace, event);
  broadcastExploreEvent(run, event);
}
