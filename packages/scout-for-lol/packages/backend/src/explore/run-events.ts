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
  if (event.type === "activity") {
    // The one thing that moves the status line. Tool events deliberately no
    // longer set it: their `message` is the generic, share-safe string, and
    // routing it here is what kept the live status as vague as the anonymous
    // audience requires. An activity event is never folded into the trace —
    // `recordExploreTraceEvent` matches only tool members — so the specific
    // text it carries cannot reach a persisted message.
    run.activity = event.text;
    broadcastExploreEvent(run, event);
    return;
  }
  if (event.type === "preview") {
    // Retained without its visualization: see the snapshot schema's comment
    // on why the chart deliberately does not survive a reconnect.
    run.preview = event.preview;
  }
  recordExploreTraceEvent(run.trace, event);
  broadcastExploreEvent(run, event);
}
