import { parseArgs } from "node:util";
import { parseScoutReleaseState } from "../scout/scout-release-state.ts";
import { parsePinCandidates } from "../pin-candidates-schema.ts";

/** Transitional compatibility for the currently running generator's PR graph.
 * Remove with activation after the replacement generator is observed live.
 * No deployment, tagging, Git mutation, storage, or network implementation lives here.
 */
function requirePrRehearsal(event: string | undefined): void {
  if (event !== "pull_request")
    throw new Error(
      "Retired release commands support only the old PR rehearsal",
    );
}

export function rehearseRetiredScoutCommand(
  args: string[],
  event: string | undefined,
): boolean {
  const command = args[0];
  if (command === "resolve-prod-pin") {
    requirePrRehearsal(event);
    if (args.length !== 1) throw new Error("Unexpected retired pin arguments");
    // There is no Git deployment queue to reconcile.
    console.log("null");
    return true;
  }
  if (
    !new Set(["archive", "deploy-beta", "reconcile-prod", "tag-release"]).has(
      command ?? "",
    )
  )
    return false;
  requirePrRehearsal(event);
  const { values } = parseArgs({
    args: args.slice(1),
    options: { state: { type: "string" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  if (values["dry-run"] !== true)
    throw new Error(
      "Retired release effects are disabled; --dry-run is required",
    );
  if (values.state === undefined) throw new Error("Rehearsal requires --state");
  const state = parseScoutReleaseState(values.state);
  console.log(
    `Validated retired ${command ?? ""} rehearsal for ${state.sourceCommit}; activation belongs to Delivery`,
  );
  return true;
}

export function rehearseRetiredCommitBack(
  args: string[],
  event: string | undefined,
): number {
  requirePrRehearsal(event);
  const { values } = parseArgs({
    args,
    options: {
      "commit-back": { type: "boolean" },
      "dry-run": { type: "boolean" },
      candidates: { type: "string" },
    },
    strict: true,
  });
  if (values["dry-run"] !== true || values["commit-back"] !== true)
    throw new Error(
      "Deployment commit-back is retired; only its PR dry-run envelope is accepted",
    );
  if (values.candidates === undefined)
    throw new Error("Rehearsal requires --candidates");
  const batch = parsePinCandidates(values.candidates);
  if (Object.keys(batch.candidates).length > 0)
    throw new Error(
      "The retired PR rehearsal accepts no deployment pin mutations",
    );
  return batch.buildNumber;
}
