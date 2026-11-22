import type {
  CarriedFailure,
  CommitBlocker,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import { carriedIn, includedNote } from "./commit-release.ts";
import { capped, distinct, plural, series } from "./commit-text.ts";

// Each verdict borrows the pipeline status it resembles and keeps its own
// words, so one `Status` draws the same glyph, green, red and amber everywhere
// in the hub.
export const VERDICT: Record<
  CommitVerdict,
  { status: string; label: string; sentence: string }
> = {
  deployed: {
    status: "succeeded",
    label: "Deployed",
    sentence: "Live in every environment that tracks it.",
  },
  deploying: {
    status: "running",
    label: "Deploying",
    sentence: "A deployment that carries it is queued or running.",
  },
  awaiting_approval: {
    status: "awaiting_approval",
    label: "Needs approval",
    sentence:
      "A deployment that carries it is waiting for someone to approve it.",
  },
  recovery_required: {
    status: "failed",
    label: "Recovery required",
    sentence:
      "A failed deployment locked an environment, so nothing reaches it until an operator recovers it.",
  },
  failed: {
    status: "failed",
    label: "Failed",
    sentence: "The newest deployment that carries it failed.",
  },
  build_failed: {
    status: "failed",
    label: "CI failed",
    sentence: "CI failed, so nothing from this commit was published.",
  },
  building: {
    status: "running",
    label: "CI running",
    sentence: "CI has not finished, so nothing is deployed yet.",
  },
  // With an environment to name, `verdictView` names what it waits on instead.
  waiting: {
    status: "pending",
    label: "Not released",
    sentence: "No release of a service it changed includes it yet.",
  },
  nothing_to_deploy: {
    status: "not_started",
    label: "Nothing to deploy",
    sentence: "This commit changed nothing that Delivery deploys.",
  },
  unknown: {
    status: "unknown",
    label: "Not seen yet",
    sentence:
      "Delivery has not heard of this commit. CI may not have published it yet.",
  },
};

/** One environment's standing: its chip's glyph and words, and why, as a sentence. */
export const ENVIRONMENT: Record<
  CommitEnvironmentState,
  { status: string; label: string; reason: string }
> = {
  live: { status: "succeeded", label: "live", reason: "has it." },
  superseded: {
    status: "succeeded",
    label: "live (newer)",
    reason: "has it through a newer release.",
  },
  deploying: {
    status: "running",
    label: "deploying",
    reason: "has a deployment that carries it queued or running.",
  },
  awaiting_approval: {
    status: "awaiting_approval",
    label: "needs approval",
    reason: "has a deployment that carries it waiting for approval.",
  },
  recovery_required: {
    status: "failed",
    label: "recovery required",
    reason: "is locked by a failed deployment until an operator recovers it.",
  },
  failed: {
    status: "failed",
    label: "failed",
    reason: "failed the newest deployment that carries it.",
  },
  canceled: {
    status: "canceled",
    label: "canceled",
    reason:
      "had the deployment that carried it canceled, and nothing else is in flight.",
  },
  replaced: {
    status: "pending",
    label: "replaced",
    reason: "ran it, then a release that does not include it replaced it.",
  },
  manual: {
    status: "pending",
    label: "needs manual release",
    reason: "needs a manual promotion or release; nothing is in flight.",
  },
  waiting: {
    status: "pending",
    label: "waiting for earlier stage",
    reason: "waits for the environment it promotes from to have it first.",
  },
  not_started: {
    status: "not_started",
    label: "not started",
    reason: "has not started a deployment of it.",
  },
};

/** Among waiting environments, a cause (a manual release) before what waits on it. */
const WAITING_ON: CommitEnvironmentState[] = [
  "manual",
  "canceled",
  "replaced",
  "not_started",
  "waiting",
];

const capitalized = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The verdict's glyph and words, the same on a list row, a commit's
 * headline and a service or environment row. A commit whose only builds
 * failed while a newer commit that includes it passed, and whose carrying
 * release changed nothing Delivery deploys, is "included in newer" rather
 * than "nothing to deploy". A commit that waits with an environment to name
 * says what it waits on ("Needs manual release"); "Not released" is left for
 * a change no release of any changed service includes yet.
 */
export function verdictView(
  verdict: CommitVerdict,
  context: {
    carried?: readonly CarriedFailure[] | undefined;
    /** The states of the environments that do not have the change yet. */
    pending?: readonly CommitEnvironmentState[] | undefined;
  } = {},
): { status: string; label: string } {
  if (verdict === "nothing_to_deploy" && (context.carried ?? []).length > 0)
    return { status: "not_started", label: "Included in newer" };
  const waitingOn = WAITING_ON.find((state) =>
    (context.pending ?? []).includes(state),
  );
  if (verdict === "waiting" && waitingOn !== undefined) {
    const state = ENVIRONMENT[waitingOn];
    return { status: state.status, label: capitalized(state.label) };
  }
  return VERDICT[verdict];
}

/** What a list row's environment tally says, short and in full. */
export function tallyText(
  group: Pick<CommitEnvironmentGroup, "name" | "liveCount" | "total">,
) {
  return {
    short: `${group.name} ${String(group.liveCount)}/${String(group.total)} live`,
    full: `${group.name}: ${String(group.liveCount)} of ${plural(group.total, "changed service", "changed services")} live`,
  };
}

/** What the list row says is stuck, named by service and environment. */
export function blockerNote(blocker: NonNullable<CommitSummary["blocker"]>) {
  return `${blocker.service} / ${blocker.environment}: ${ENVIRONMENT[blocker.state].label}`;
}

/** Environments in these states need someone to look at them. */
const FAILING: ReadonlySet<CommitEnvironmentState> = new Set([
  "recovery_required",
  "failed",
]);

/** How many failing environments a list row names before "+N more". */
const NAMED_FAILURES = 3;

type StuckGroup = {
  state: CommitEnvironmentState;
  /** The environments held back in this state, of services this state describes. */
  members: CommitBlocker[];
  /** How many services those are. */
  count: number;
};

/**
 * Every service held back, in the one state that describes it: the most
 * urgent state of any of its environments. A service is counted once, so the
 * groups and the services that are live add up to the services changed.
 * Groups come in the order the blockers do, most urgent first.
 */
function stuckGroups(blockers: readonly CommitBlocker[]): StuckGroup[] {
  const describing = new Map<string, CommitEnvironmentState>();
  for (const blocker of blockers)
    if (!describing.has(blocker.service))
      describing.set(blocker.service, blocker.state);
  const groups = new Map<CommitEnvironmentState, CommitBlocker[]>();
  for (const blocker of blockers)
    if (describing.get(blocker.service) === blocker.state)
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
function namedWithMore(items: readonly string[]) {
  return items.length <= NAMED_FAILURES
    ? series(items)
    : `${items.slice(0, NAMED_FAILURES).join(", ")} +${String(items.length - NAMED_FAILURES)} more`;
}

/**
 * What the list row says is stuck: every failing environment, up to three
 * and then how many more, then each other state that holds services back
 * (awaiting approval, deploying, canceled, not started) with its services,
 * so what the row names and what is live add up to what changed.
 */
export function blockerNotes(blockers: readonly CommitBlocker[]): string[] {
  const failing = blockers.filter((blocker) => FAILING.has(blocker.state));
  const others = stuckGroups(blockers).filter(
    (group) => !FAILING.has(group.state),
  );
  return [
    ...failing.slice(0, NAMED_FAILURES).map((blocker) => blockerNote(blocker)),
    ...(failing.length > NAMED_FAILURES
      ? [`+${String(failing.length - NAMED_FAILURES)} more failing`]
      : []),
    ...others.map((group) =>
      group.members.length === 1 && group.members[0] !== undefined
        ? blockerNote(group.members[0])
        : `${String(group.count)} ${DOING[group.state][1]}: ${namedWithMore(
            group.members.map(
              (member) => `${member.service} / ${member.environment}`,
            ),
          )}`,
    ),
  ];
}

/** "CI failed for Arcade and Golink", or by count when no name is known. */
function failedNote(names: readonly string[], count: number) {
  return `CI failed for ${names.length > 0 ? capped(names) : plural(count, "service", "services")}`;
}

/**
 * The list row's notes beside its tallies: CI that failed with nothing
 * carrying it, by service, failures a newer commit carries, then what is
 * stuck.
 */
export function rowNotes(commit: CommitSummary): string[] {
  const carried = commit.carriedFailures ?? [];
  const failing = commit.failedBuildCount - carried.length;
  const notes: string[] = [];
  if (failing > 0) notes.push(failedNote(commit.failedServices ?? [], failing));
  if (carried.length > 0) notes.push(includedNote(carried));
  notes.push(
    ...blockerNotes(
      commit.blockers ?? (commit.blocker === null ? [] : [commit.blocker]),
    ),
  );
  return notes;
}

/**
 * The commit page's one statement. What decided the verdict comes first:
 * CI that failed with nothing carrying it, or else the most urgent thing
 * holding changed services back, counted and named. Then how many are live,
 * then which failed builds a newer commit carries. A commit whose own CI
 * failed for some services can still have its other changes live, often
 * through newer commits; the statement says so instead of contradicting the
 * rows.
 */
export function commitStatement(status: CommitStatus): string {
  const carried = status.carriedFailures ?? [];
  // A changed service no environment tracks has nowhere to be live.
  const changed = status.changed.filter(
    (entry) => entry.environments.length > 0,
  );
  const { failed, included } = ciSentences(status, carried);
  const live =
    changed.length === 0
      ? []
      : liveness(
          changed,
          status.blockers ?? (status.blocker === null ? [] : [status.blocker]),
        );
  // CI failure decided the verdict, so it leads; otherwise what is stuck does.
  if (status.verdict === "build_failed")
    return [
      ...(changed.length > 0 || carried.length > 0
        ? failed
        : [VERDICT.build_failed.sentence]),
      ...live,
      ...included,
    ].join(" ");
  return [
    ...opening(status, changed.length > 0, carried.length > 0),
    ...live,
    ...failed,
    ...included,
  ].join(" ");
}

/** The services a list of builds belongs to, by title, each once. */
const serviceNames = (builds: CommitStatus["failedBuilds"]) =>
  distinct(builds.map((build) => build.serviceTitle ?? build.serviceId));

/** What CI failed for with nothing carrying it, and which failures a newer commit carries. */
function ciSentences(status: CommitStatus, carried: readonly CarriedFailure[]) {
  const carriedIds = new Set(carried.map((entry) => entry.buildId));
  const failed = serviceNames(
    status.failedBuilds.filter((build) => !carriedIds.has(build.id)),
  );
  const carriedNames = serviceNames(
    status.failedBuilds.filter((build) => carriedIds.has(build.id)),
  );
  const one = carriedNames.length <= 1;
  return {
    failed:
      failed.length === 0
        ? []
        : [
            `${failedNote(failed, failed.length)}, so Delivery published nothing for ${failed.length === 1 ? "it" : "them"}.`,
          ],
    included:
      carried.length === 0
        ? []
        : [
            `${failedNote(carriedNames, carried.length)} here, so ${one ? "it was" : "they were"} not built on ${one ? "its" : "their"} own; included in ${carriedIn(carried)}.`,
          ],
  };
}

/**
 * The verdict's own sentence when no changed service can say more: CI still
 * running, or a commit that changed nothing Delivery deploys.
 */
function opening(status: CommitStatus, changed: boolean, carried: boolean) {
  if (changed)
    return status.verdict === "building"
      ? [
          `CI is still running for ${capped(serviceNames(status.pendingBuilds))}.`,
        ]
      : [];
  // The included sentence says what happened; "changed nothing" would be untrue.
  return carried && status.verdict === "nothing_to_deploy"
    ? []
    : [VERDICT[status.verdict].sentence];
}

/** What a number of changed services in one state are doing: singular, plural. */
const DOING: Record<CommitEnvironmentState, [string, string]> = {
  live: ["is live", "are live"],
  superseded: ["is live", "are live"],
  recovery_required: [
    "needs an operator to recover its environment",
    "need an operator to recover their environments",
  ],
  failed: ["failed to deploy", "failed to deploy"],
  awaiting_approval: ["needs approval", "need approval"],
  deploying: ["is deploying", "are deploying"],
  manual: ["needs a manual release", "need a manual release"],
  canceled: ["had its deployment canceled", "had their deployments canceled"],
  replaced: [
    "was replaced by a release without it",
    "were replaced by a release without it",
  ],
  waiting: ["waits for an earlier stage", "wait for an earlier stage"],
  not_started: ["has not started deploying", "have not started deploying"],
};

/**
 * How many changed services are live. If not all, the most urgent thing
 * holding them back comes first, counted and named by service and
 * environment: "1 of 20 changed services needs a manual release: Temporal
 * data layer prod. 19 of 20 are live."
 */
function liveness(
  changed: CommitStatus["changed"],
  blockers: readonly CommitBlocker[],
): string[] {
  const total = changed.length;
  const live = changed.filter((entry) => entry.verdict === "deployed").length;
  if (blockers.length > 0) return heldBack(blockers, live, total);
  if (live < total)
    return [
      `${String(live)} of ${plural(total, "changed service is", "changed services are")} live.`,
    ];
  return [allLive(changed)];
}

/**
 * What holds changed services back, every state in turn, most urgent first,
 * each service in exactly one: the most urgent state first with its count of
 * the whole ("1 of 17 changed services failed to deploy: A prod."), the
 * others by count ("2 need approval: B prod and C prod."), up to three
 * named per state and then "+N more". Last, how many are live, so the
 * counts add up to the total.
 */
function heldBack(
  blockers: readonly CommitBlocker[],
  live: number,
  total: number,
) {
  const sentences = stuckGroups(blockers).map((group, position) => {
    const [one, many] = DOING[group.state];
    const named = namedWithMore(
      group.members.map((member) => `${member.service} ${member.environment}`),
    );
    const everyOne =
      total === 1
        ? "Its changed service"
        : `All ${String(total)} changed services`;
    const subject =
      position > 0
        ? String(group.count)
        : group.count < total
          ? `${String(group.count)} of ${plural(total, "changed service", "changed services")}`
          : everyOne;
    return `${subject} ${group.count === 1 ? one : many}: ${named}.`;
  });
  return [
    ...sentences,
    ...(live === 0
      ? []
      : [
          `${String(live)} of ${String(total)} ${live === 1 ? "is" : "are"} live.`,
        ]),
  ];
}

/** Every changed service is live, said once, and why when newer commits carry it. */
function allLive(changed: CommitStatus["changed"]) {
  const subject =
    changed.length === 1
      ? "Its 1 changed service is"
      : `All ${String(changed.length)} changed services are`;
  const throughNewer = changed.every((entry) =>
    entry.environments.every(
      (environment) => environment.state === "superseded",
    ),
  );
  return throughNewer
    ? `${subject} live because newer commits include ${changed.length === 1 ? "it" : "them"}.`
    : `${subject} live.`;
}

/**
 * What a commit page says where Delivery recorded no title or author: that
 * it did not, and, if Woodpecker's stored pipeline has the missing parts,
 * what it says, named as the pipeline's words. Null when both are recorded.
 */
export function missingIdentity(
  commit: Pick<CommitStatus, "title" | "author" | "pipeline">,
): string | null {
  const noTitle = commit.title === null;
  const noAuthor = commit.author === null;
  if (!noTitle && !noAuthor) return null;
  const what =
    noTitle && noAuthor
      ? "Title and author were"
      : noTitle
        ? "Title was"
        : "Author was";
  const standIn = [
    ...(noTitle && commit.pipeline?.title != null
      ? [`the title "${commit.pipeline.title}"`]
      : []),
    ...(noAuthor && commit.pipeline?.author != null
      ? [`the author ${commit.pipeline.author}`]
      : []),
  ];
  const note =
    commit.pipeline === undefined || standIn.length === 0
      ? ""
      : ` Woodpecker pipeline #${String(commit.pipeline.number)} has ${standIn.join(" and ")}.`;
  return `${what} not captured for this commit.${note}`;
}

/** The line under the changed services: how many built with nothing to deploy. */
export function unchangedLine(count: number) {
  return `${plural(count, "other service", "other services")} built with nothing to deploy.`;
}

const SHA = /^[0-9a-f]{7,40}$/iu;

/** A pasted commit SHA, trimmed; null when it is not 7 to 40 hex digits. */
export function parseSha(input: string): string | null {
  const sha = input.trim();
  return SHA.test(sha) ? sha.toLowerCase() : null;
}
