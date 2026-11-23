import type { z } from "zod";
import type { BundleReviewProtocolSchema } from "#shared/handoff/library-bundle.ts";
import type { MigrationProposalSchema } from "#shared/migration.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import {
  movieEntries,
  requestEntries,
  seriesEntries,
  unresolved,
  type Entry,
} from "./migration-entries.ts";

type Proposal = z.input<typeof MigrationProposalSchema>;
type Bundle = z.input<typeof BundleReviewProtocolSchema>;

/** The captures the migration fixtures describe, by the source they came from. */
export const CAPTURES = {
  radarr: {
    proposalId: fixtureId(17, 1),
    captureId: fixtureId(17, 101),
    hash: sha256("capture-1"),
    instanceId: sha256("instance-radarr"),
  },
  sonarr: {
    proposalId: fixtureId(17, 2),
    captureId: fixtureId(17, 102),
    hash: sha256("capture-2"),
    instanceId: sha256("instance-sonarr"),
  },
  overseerr: {
    proposalId: fixtureId(17, 3),
    captureId: fixtureId(17, 103),
    hash: sha256("capture-3"),
    instanceId: sha256("instance-overseerr"),
  },
  bazarr: {
    proposalId: fixtureId(17, 5),
    captureId: fixtureId(17, 105),
    hash: sha256("capture-5"),
    instanceId: sha256("instance-bazarr"),
  },
} as const;

export const BUNDLE_IDS = {
  awaitingReview: fixtureId(18, 1),
  approved: fixtureId(18, 2),
  protectedBundle: fixtureId(18, 3),
} as const;

const REPORT_ENTRIES = {
  radarr: () => [...movieEntries()],
  sonarr: () => [...seriesEntries(26)],
  overseerr: () => [...requestEntries()],
  bazarr: () => [...unresolved()],
} as const;

/** One captured source, in full: its summary plus the report the page reviews. */
export function migrationProposalDetail(
  summary: Omit<Proposal, "report">,
): Proposal {
  const kind = summary.source.kind;
  const entries =
    kind === "radarr" ||
    kind === "sonarr" ||
    kind === "overseerr" ||
    kind === "bazarr"
      ? REPORT_ENTRIES[kind]()
      : [];
  const whole = summary.status !== "protected";
  return {
    ...summary,
    report: {
      schemaVersion: 1,
      captureHash: summary.captureHash,
      reportHash: summary.reportHash,
      complete: whole,
      stable: whole,
      entries,
      mayTransferOwnership: false,
    },
  };
}

function fromCapture(entries: readonly Entry[], captureHash: string) {
  return entries.map((item) => ({ ...item, captureHash }));
}

/** A prepared library report: both managers' records, ready to select from. */
export function bundleReviewDetail(
  id: string,
  summary: { status: Bundle["status"]; version: number; createdAt: string },
): Bundle {
  const radarr = CAPTURES.radarr;
  const sonarr = CAPTURES.sonarr;
  const entries = [
    ...fromCapture(movieEntries(), radarr.hash),
    ...fromCapture(seriesEntries(30), sonarr.hash),
    ...fromCapture(unresolved(), CAPTURES.bazarr.hash),
  ];
  const whole = summary.status !== "protected";
  const selection = entries
    .filter(
      (item) =>
        summary.status === "approved" &&
        item.state === "adoptable_evidence_ready" &&
        item.kind === "file",
    )
    .map((item) => ({
      provenanceKey: item.provenanceKey,
      evidenceHash: item.observationHash,
    }));
  return {
    id,
    bundleId: fixtureId(18, 900 + summary.version),
    manifest: {
      schemaVersion: 2,
      purpose: "initial_library",
      bundleHash: sha256(`bundle-manifest:${id}`),
      captures: [
        {
          captureId: radarr.captureId,
          captureHash: radarr.hash,
          sourceKind: "radarr",
          sourceInstanceId: radarr.instanceId,
        },
        {
          captureId: sonarr.captureId,
          captureHash: sonarr.hash,
          sourceKind: "sonarr",
          sourceInstanceId: sonarr.instanceId,
        },
        {
          captureId: CAPTURES.bazarr.captureId,
          captureHash: CAPTURES.bazarr.hash,
          sourceKind: "bazarr",
          sourceInstanceId: CAPTURES.bazarr.instanceId,
        },
      ],
      associations: [],
      requiredSources: ["radarr", "sonarr", "bazarr"],
      complete: whole,
      stable: whole,
      rootMappings: [
        {
          captureId: radarr.captureId,
          sourceRoot: "/movies",
          canonicalRoot: "/data/movies",
          verified: false,
        },
        {
          captureId: sonarr.captureId,
          sourceRoot: "/tv",
          canonicalRoot: "/data/tv",
          verified: false,
        },
      ],
    },
    report: {
      schemaVersion: 1,
      bundleHash: sha256(`bundle-manifest:${id}`),
      reportHash: sha256(`bundle-${String(summary.version)}`),
      complete: whole,
      stable: whole,
      entries,
      mayTransferOwnership: false,
    },
    selection,
    recoveryEpoch: 1,
    runtimeVersion: 12,
    status: summary.status,
    version: summary.version,
    createdAt: summary.createdAt,
  };
}
