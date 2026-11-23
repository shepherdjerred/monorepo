import type {
  CommitBlocker,
  CommitEnvironmentState,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import { ENVIRONMENT } from "./commit-labels.ts";
import { series } from "./commit-text.ts";

/** What the list row says is stuck, named by service and environment. */
export function blockerNote(blocker: NonNullable<CommitSummary["blocker"]>) {
  return `${blocker.service} / ${blocker.environment}: ${ENVIRONMENT[blocker.state].label}`;
}

/** Environments in these states need someone to look at them. */
const FAILING: ReadonlySet<CommitEnvironmentState> = new Set([
  "recovery_required",
  "failed",
]);

/** How many environments or services a note names before "+N more". */
const NAMED_FAILURES = 3;

export type StuckGroup = {
  state: CommitEnvironmentState;
  /** The environments held back in this state. */
  members: CommitBlocker[];
  /** How many services those are. */
  count: number;
};

/**
 * Every service held back, in the one state that describes it: the most
 * urgent state of any of its environments. A service is counted once, so the
 * groups and the services that are live add up to the services changed.
 * Groups come in the order the blockers do, most urgent first. With
 * `others`, the opposite: the environments a service is held back in beyond
 * the one that describes it, such as the prod it waits to promote to while
 * its beta deploys.
 */
export function stuckGroups(
  blockers: readonly CommitBlocker[],
  others = false,
): StuckGroup[] {
  const describing = new Map<string, CommitEnvironmentState>();
  for (const blocker of blockers)
    if (!describing.has(blocker.service))
      describing.set(blocker.service, blocker.state);
  const groups = new Map<CommitEnvironmentState, CommitBlocker[]>();
  for (const blocker of blockers)
    if ((describing.get(blocker.service) === blocker.state) !== others)
      groups.set(blocker.state, [
        ...(groups.get(blocker.state) ?? []),
        blocker,
      ]);
  return [...groups].map(([state, members]) => ({
    state,
    members,
    count: new Set(members.map((member) => member.service)).size,
  }));
}

/** Up to three names, then how many more: "a, b, c +2 more". */
export function namedWithMore(items: readonly string[]) {
  return items.length <= NAMED_FAILURES
    ? series(items)
    : `${items.slice(0, NAMED_FAILURES).join(", ")} +${String(items.length - NAMED_FAILURES)} more`;
}

/** One state's group as a row note: the one environment in its own words, or the count and names. */
function groupNote(group: StuckGroup) {
  const [only] = group.members;
  return only !== undefined && group.members.length === 1
    ? blockerNote(only)
    : `${String(group.count)} ${DOING[group.state][group.count === 1 ? 0 : 1]}: ${namedWithMore(
        group.members.map(
          (member) => `${member.service} / ${member.environment}`,
        ),
      )}`;
}

/**
 * What the list row says is stuck: every failing environment, up to three
 * and then how many more, then each other state that holds services back
 * (awaiting approval, queued, canceled, not started) with its services, then
 * the other environments those services wait in, so every environment tally
 * short of all live has a service named behind it.
 */
export function blockerNotes(blockers: readonly CommitBlocker[]): string[] {
  const failing = blockers.filter((blocker) => FAILING.has(blocker.state));
  const notFailing = (others: boolean) =>
    stuckGroups(blockers, others).filter((group) => !FAILING.has(group.state));
  return [
    ...failing.slice(0, NAMED_FAILURES).map((blocker) => blockerNote(blocker)),
    ...(failing.length > NAMED_FAILURES
      ? [`+${String(failing.length - NAMED_FAILURES)} more failing`]
      : []),
    ...notFailing(false).map((group) => groupNote(group)),
    ...notFailing(true).map((group) => groupNote(group)),
  ];
}

/** What a number of changed services in one state are doing: singular, plural. */
export const DOING: Record<CommitEnvironmentState, [string, string]> = {
  live: ["is live", "are live"],
  superseded: ["is live", "are live"],
  recovery_required: [
    "needs an operator to recover its environment",
    "need an operator to recover their environments",
  ],
  failed: ["failed to deploy", "failed to deploy"],
  awaiting_approval: ["needs approval", "need approval"],
  deploying: ["is deploying", "are deploying"],
  queued: ["is queued", "are queued"],
  manual: ["needs a manual release", "need a manual release"],
  canceled: ["had its deployment canceled", "had their deployments canceled"],
  replaced: [
    "was replaced by a release without it",
    "were replaced by a release without it",
  ],
  waiting: ["waits for an earlier stage", "wait for an earlier stage"],
  not_started: ["has not started deploying", "have not started deploying"],
};
