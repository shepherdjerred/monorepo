/**
 * Command claims: `take`, `claim`, `handoff`, `release`. The server decides
 * every claim with one compare-and-set, so these commands only report its
 * outcome; `take --spawn` additionally spawns a commander for a won lease.
 */
import type { ActorInput } from "@shepherdjerred/incidents/contract";
import { incidentRefusal } from "#lib/incidents/client.ts";
import { dispatchCommander } from "#lib/incidents/dispatch.ts";
import { isDispatchHandle } from "#lib/incidents/dispatch-handles.ts";
import { summaryLine } from "#lib/incidents/guidance.ts";
import { textInput } from "#commands/tracker/options.ts";
import {
  formatChange,
  redactedTake,
  result,
  type IncidentResult,
} from "./format.ts";
import { currentRevision, type IncidentCommandContext } from "./record.ts";
import {
  INCIDENT_EXIT,
  IncidentUsageError,
  refArg,
  requireValue,
  type IncidentOptions,
} from "./options.ts";

const TAKEN_HINT = {
  "owned-by-other": "another actor commands it",
  "dispatch-in-progress": "another agent is spawning its commander",
  "not-eligible-yet":
    "its takeover grace has not passed and you are not its creator or suspect (--force overrides, and is recorded)",
} as const;

async function take(
  context: IncidentCommandContext,
  ref: string,
  options: IncidentOptions,
): Promise<IncidentResult> {
  const actor = await context.actor();
  const note = await textInput(options.note, options["note-file"]);
  const taken = await context.api.take({
    actor,
    ref,
    dispatch: options.spawn,
    force: options.force,
    ...(note === undefined ? {} : { note }),
  });
  const id = taken.incident.identifier;
  if (taken.outcome === "taken")
    return result(
      INCIDENT_EXIT.notTaken,
      taken,
      `Not taken: ${TAKEN_HINT[taken.reason]}.\n${summaryLine(taken.incident)}\nWait instead: toolkit incident wait ${id}`,
    );
  if (taken.outcome === "owned")
    return result(
      INCIDENT_EXIT.ok,
      taken,
      `You are commander of ${summaryLine(taken.incident)}\nPost milestones: toolkit incident update ${id} --body "<progress>"; resolve with evidence: toolkit incident resolve ${id} --expected-revision <N> --note "<evidence>"`,
    );
  const attempt = await dispatchCommander(
    { ...context, actor, now: context.scheduler.now },
    id,
    taken,
  );
  const json = { take: redactedTake(taken), dispatch: attempt };
  return attempt.outcome === "spawned"
    ? result(
        INCIDENT_EXIT.ok,
        json,
        `Spawned a ${taken.provider} commander session for ${id}; it must claim before ${taken.leaseExpiresAt}.`,
      )
    : result(
        INCIDENT_EXIT.failure,
        json,
        `Spawn failed and the lease was released: ${attempt.error ?? "unknown error"}`,
      );
}

/**
 * Redeem the dispatch handle from the first message. The token itself is read
 * from this machine's handle store and never appears on a command line.
 */
async function claim(
  context: IncidentCommandContext,
  ref: string,
  actor: ActorInput,
  options: IncidentOptions,
): Promise<IncidentResult> {
  const handle = requireValue(options["dispatch-handle"], "--dispatch-handle");
  if (!isDispatchHandle(handle))
    throw new IncidentUsageError(
      `--dispatch-handle ${handle} is not a dispatch handle`,
    );
  const token = await context.handles.read(handle);
  if (token === null)
    return result(
      INCIDENT_EXIT.notTaken,
      { error: { code: "NO_HANDLE", handle } },
      `No dispatch handle ${handle} on this machine: claim from the machine whose waiter spawned you. Its lease may also have lapsed; check with toolkit incident view ${ref}.`,
    );
  let detail;
  try {
    detail = await context.api.claimDispatch({
      actor,
      ref,
      dispatchToken: token,
    });
  } catch (error) {
    // A refused claim (lapsed, redeemed, or wrong token) can never succeed later.
    if (incidentRefusal(error) !== null) await context.handles.remove(handle);
    throw error;
  }
  await context.handles.remove(handle);
  return result(
    INCIDENT_EXIT.ok,
    detail,
    [
      `You are commander of ${detail.identifier}.`,
      formatChange(detail),
      `Post milestones: toolkit incident update ${detail.identifier} --body "<progress>"; resolve with evidence: toolkit incident resolve ${detail.identifier} --expected-revision <N> --note "<evidence>"`,
    ].join("\n"),
  );
}

export async function incidentClaimCommand(
  context: IncidentCommandContext,
  action: "take" | "claim" | "handoff" | "release",
  positionals: string[],
  options: IncidentOptions,
): Promise<IncidentResult> {
  const ref = refArg(positionals, action);
  if (action === "take") return take(context, ref, options);
  const actor = await context.actor();
  if (action === "claim") return claim(context, ref, actor, options);
  const note = await textInput(options.note, options["note-file"]);
  const to =
    action === "release" ? null : requireValue(options.to, "--to KEY|none");
  if (action === "release" && options.to !== undefined)
    throw new IncidentUsageError("release takes no --to; use handoff --to KEY");
  const detail = await context.api.handoff({
    actor,
    ref,
    expectedRevision: await currentRevision(context, ref, options),
    to: to === "none" ? null : to,
    ...(note === undefined ? {} : { note }),
  });
  return result(INCIDENT_EXIT.ok, detail, formatChange(detail));
}
