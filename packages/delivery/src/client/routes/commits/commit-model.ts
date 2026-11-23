import type {
  CarriedFailure,
  CommitBlocker,
  CommitEnvironment,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitService,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import { includedNote, releasesNote } from "./commit-release.ts";
import { capped, distinct, plural } from "./commit-text.ts";
import { ENVIRONMENT, VERDICT } from "./commit-labels.ts";
import {
  DOING,
  blockerNotes,
  namedWithMore,
  stuckGroups,
} from "./commit-blockers.ts";

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

/** What a release's own deployment did, said before "superseded". */
const OWN_ENDING: Partial<Record<PipelineStatus, string>> = {
  failed: "failed",
  canceled: "canceled",
};

/**
 * One environment chip's glyph and words. Where a newer accepted release
 * carries the change, the chip does not call the release live: it says it
 * was superseded by that release, which is deployed, and first what the
 * release's own deployment did when that failed or was canceled ("failed,
 * superseded by r381, which is deployed").
 */
export function environmentView(
  entry: Pick<CommitEnvironment, "state" | "release">,
): { status: string; label: string } {
  const by = entry.release?.supersededBy;
  if (by === undefined || entry.state !== "superseded")
    return ENVIRONMENT[entry.state];
  const own =
    entry.release?.status === null || entry.release === undefined
      ? undefined
      : OWN_ENDING[entry.release.status];
  return {
    status: own ?? "succeeded",
    label: `${own === undefined ? "" : `${own}, `}superseded by r${String(by)}, which is deployed`,
  };
}

/**
 * A service row's glyph and words. A row that names a release (r346) whose
 * environments all hold a newer release instead says so, and first what
 * the release's own deployment did when it failed ("Failed, superseded") or
 * was canceled ("Canceled, superseded"; no deployment failed), rather than
 * the service's "Deployed".
 */
export function rowStanding(
  entry: Pick<CommitService, "verdict" | "environments">,
  pending: readonly CommitEnvironmentState[],
): { status: string; label: string } {
  const superseded = entry.environments.filter(
    (environment) =>
      environment.state === "superseded" &&
      environment.release?.supersededBy !== undefined,
  );
  if (
    superseded.length === 0 ||
    superseded.length !== entry.environments.length
  )
    return verdictView(entry.verdict, { pending });
  const outcomes = new Set(
    superseded.map((environment) => environment.release?.status),
  );
  // A failed deployment outranks a canceled one; a canceled one is never "Failed".
  if (outcomes.has("failed"))
    return { status: "failed", label: "Failed, superseded" };
  return outcomes.has("canceled")
    ? { status: "canceled", label: "Canceled, superseded" }
    : { status: "succeeded", label: "Superseded" };
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

/** "CI failed for Arcade and Golink", or by count when no name is known. */
function failedNote(names: readonly string[], count: number) {
  return `CI failed for ${names.length > 0 ? capped(names) : plural(count, "service", "services")}`;
}

/**
 * The list row's notes beside its tallies: CI that failed with nothing
 * carrying it, by service, failures a newer commit carries and where their
 * releases stand, then what is stuck.
 */
export function rowNotes(commit: CommitSummary): string[] {
  const carried = commit.carriedFailures ?? [];
  const failing = commit.failedBuildCount - carried.length;
  const notes: string[] = [];
  if (failing > 0) notes.push(failedNote(commit.failedServices ?? [], failing));
  if (carried.length > 0) notes.push(includedNote(carried));
  const releases = releasesNote(commit.carriedReleases);
  if (releases !== null) notes.push(releases);
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
  return {
    failed:
      failed.length === 0
        ? []
        : [
            `${failedNote(failed, failed.length)}, so Delivery published nothing for ${failed.length === 1 ? "it" : "them"}.`,
          ],
    included: carried.length === 0 ? [] : [`${includedNote(carried)}.`],
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
