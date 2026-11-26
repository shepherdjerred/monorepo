// TODO(incidents-integration): import from "@shepherdjerred/incidents/contract"
// once the package declares that export.
import {
  IncidentSignalBatchSchema,
  type IncidentLinkInput,
  type IncidentSignalBatch,
  type IncidentSuspect,
} from "@shepherdjerred/incidents/src/shared/contract.ts";
import type {
  BranchStatus,
  WoodpeckerPipelineDetail,
} from "@shepherdjerred/ops-clients/woodpecker.ts";
import {
  incidentsSignalLastSuccessTimestampSeconds,
  incidentsSignalPostOk,
} from "#observability/metrics-ops.ts";
import { createStructuredLogger } from "#observability/logging.ts";
import { ciVerdictTitle, isRedVerdict } from "#activities/ops/ci.ts";
import { MONOREPO_URL } from "#activities/ops/ops-links.ts";
import { redactFailure, type OpsPoster } from "#activities/ops/ops-publish.ts";
import { truncate } from "#activities/ops/ops-types.ts";

/** One incident per red `main`; the Incidents server dedupes on this key. */
const MAIN_CI_SIGNAL_KEY = "main-ci:main";
export const MAIN_CI_EXIT_CONDITION =
  "A main pipeline on a newer commit passes verify, images, helm-push, and delivery-publish";
const INCIDENT_SIGNALS_PATH = "/api/incidents/internal/signals";

const log = createStructuredLogger("ops.incidents-signal");

/** The commit fields a suspect is read from. */
type SuspectCommit = Pick<
  WoodpeckerPipelineDetail,
  "commit" | "message" | "author"
>;

/** A squash-merge subject ends with its pull request: `feat: x (#1234)`. */
const PR_SUBJECT = /\(#([1-9]\d*)\)\s*$/u;
/** Harness trailers that carry a session link, e.g. `Claude-Session: https://claude.ai/code/session_…`. */
const SESSION_TRAILER = /^Claude-Session:\s*(\S+)\s*$/gimu;

/** The session id is the link's last path segment (`session_…`). */
function sessionIdFromLink(link: string): string | undefined {
  let path: string;
  try {
    path = new URL(link).pathname;
  } catch {
    return link;
  }
  const segment = path.split("/").findLast((part) => part !== "");
  return segment === undefined ? undefined : decodeURIComponent(segment);
}

/**
 * Who most likely broke `main`: the failing pipeline's commit, its pull
 * request (from the squash subject), the harness session that authored it
 * (from its trailer), and the commit author.
 */
export function parseCommitSuspect(commit: SuspectCommit): IncidentSuspect {
  const subject = commit.message.split("\n", 1)[0] ?? "";
  const prNumber = PR_SUBJECT.exec(subject)?.[1];
  const sessionLinks = [...commit.message.matchAll(SESSION_TRAILER)].map(
    (match) => match[1] ?? "",
  );
  // A squash message can concatenate several commits' trailers; the last one
  // belongs to the session that finished the change.
  const sessionLink = sessionLinks.at(-1);
  const sessionId =
    sessionLink === undefined ? undefined : sessionIdFromLink(sessionLink);
  const author = commit.author.trim();
  return {
    commitSha: commit.commit.toLowerCase(),
    ...(prNumber === undefined ? {} : { prNumber: Number(prNumber) }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(author === "" ? {} : { author }),
  };
}

/**
 * The `main-ci` signal for `main`'s current verdict. Red fires with a suspect
 * from the failing commit; green clears. `failing` is the verdict pipeline's
 * detail, required when the verdict is red.
 */
export function buildMainCiSignalBatch(input: {
  status: BranchStatus;
  failing: WoodpeckerPipelineDetail | undefined;
  observedAt: Date;
}): IncidentSignalBatch {
  const { verdict } = input.status;
  if (verdict === undefined) {
    throw new Error("Woodpecker has no finished push pipeline of main");
  }
  const firing = isRedVerdict(verdict);
  if (firing && input.failing?.number !== verdict.number) {
    throw new Error(
      `A red main signal needs pipeline #${String(verdict.number)}'s detail`,
    );
  }
  const suspect =
    firing && input.failing !== undefined
      ? parseCommitSuspect(input.failing)
      : undefined;
  const links: IncidentLinkInput[] = [
    {
      kind: "pipeline",
      ref: String(verdict.number),
      url: verdict.url,
      title: `Pipeline #${String(verdict.number)}`,
    },
    {
      kind: "commit",
      ref: verdict.commit,
      url: `${MONOREPO_URL}/commit/${verdict.commit}`,
      title: `Commit ${verdict.commit.slice(0, 7)}`,
    },
    ...(suspect?.prNumber === undefined
      ? []
      : [
          {
            kind: "pr" as const,
            ref: String(suspect.prNumber),
            url: `${MONOREPO_URL}/pull/${String(suspect.prNumber)}`,
            title: `PR #${String(suspect.prNumber)}`,
          },
        ]),
  ];
  return IncidentSignalBatchSchema.parse({
    signals: [
      {
        source: "main-ci",
        key: MAIN_CI_SIGNAL_KEY,
        firing,
        system: "main-ci",
        severity: "sev2",
        title: ciVerdictTitle(verdict),
        summary: truncate(verdict.message, 500),
        exitCondition: MAIN_CI_EXIT_CONDITION,
        observedAt: input.observedAt.toISOString(),
        ...(suspect === undefined ? {} : { suspect }),
        links,
      },
    ],
  });
}

type MainCiSignalOutcome = { ok: true } | { ok: false; error: string };

/**
 * Report `main`'s verdict to Hub's Incidents module. Every snapshot posts the
 * current state; the server dedupes on the signal key, so a retried Activity
 * repeats a post harmlessly.
 *
 * Optional output of the CI collector: an upstream failure (the failing
 * pipeline's detail, or Hub) is logged and drives `incidents_signal_post_ok`
 * to 0 for `IncidentsSignalDeliveryFailing` instead of failing the snapshot's
 * CI source. A batch that breaks the contract still throws.
 */
export async function publishMainCiSignal(input: {
  status: BranchStatus;
  fetchPipeline: (number: number) => Promise<WoodpeckerPipelineDetail>;
  dashboardUrl: string;
  token: string;
  post: OpsPoster;
  now: Date;
  secrets: readonly (string | undefined)[];
}): Promise<MainCiSignalOutcome> {
  const { verdict } = input.status;
  let failing: WoodpeckerPipelineDetail | undefined;
  try {
    failing =
      verdict !== undefined && isRedVerdict(verdict)
        ? await input.fetchPipeline(verdict.number)
        : undefined;
  } catch (error: unknown) {
    return recordFailure(error, input.secrets);
  }
  const body = buildMainCiSignalBatch({
    status: input.status,
    failing,
    observedAt: input.now,
  });
  try {
    await input.post({
      url: new URL(INCIDENT_SIGNALS_PATH, input.dashboardUrl).toString(),
      token: input.token,
      body,
    });
  } catch (error: unknown) {
    return recordFailure(error, input.secrets);
  }
  incidentsSignalPostOk.set({ source: "main-ci" }, 1);
  incidentsSignalLastSuccessTimestampSeconds.set(
    { source: "main-ci" },
    Math.floor(input.now.getTime() / 1000),
  );
  return { ok: true };
}

function recordFailure(
  error: unknown,
  secrets: readonly (string | undefined)[],
): MainCiSignalOutcome {
  const reason = redactFailure(
    error instanceof Error ? error.message : String(error),
    secrets,
  );
  incidentsSignalPostOk.set({ source: "main-ci" }, 0);
  log("warning", "Incidents main-ci signal was not delivered", {
    source: "main-ci",
    key: MAIN_CI_SIGNAL_KEY,
    error: reason,
  });
  return { ok: false, error: reason };
}
