import type { BranchStatus } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { MONOREPO_URL } from "./ops-links.ts";
import { truncate, type OpsCollection, type OpsContext } from "./ops-types.ts";

/**
 * The CI verdict of `main`: the newest push pipeline that passed or failed. A
 * red verdict is an error; the newest in-flight pipeline is carried as context.
 */
export function mapCi(
  status: BranchStatus,
  context: OpsContext,
): OpsCollection {
  const { verdict, latest } = status;
  if (verdict === undefined) {
    throw new Error("Woodpecker has no finished push pipeline of main");
  }
  const failed = verdict.status !== "success";
  const signal: SignalInput = {
    id: "ci:main",
    source: "ci",
    section: "delivery",
    service: context.services.requireById("ci").id,
    kind: "ci-branch",
    severity: failed ? "error" : "ok",
    needsMe: false,
    title: failed
      ? `main is red: pipeline #${String(verdict.number)} ${verdict.status}`
      : `main is green: pipeline #${String(verdict.number)} passed`,
    detail: truncate(verdict.message, 200),
    since: new Date(
      Date.parse(verdict.finishedAt ?? verdict.createdAt),
    ).toISOString(),
    attributes: {
      build: verdict.number,
      commit: verdict.commit.slice(0, 12),
      ...(latest === undefined || latest.number === verdict.number
        ? {}
        : { latestBuild: latest.number, latestState: latest.status }),
    },
    links: [
      {
        kind: "woodpecker",
        label: `Pipeline #${String(verdict.number)}`,
        url: verdict.url,
      },
      {
        kind: "github",
        label: `Commit ${verdict.commit.slice(0, 7)}`,
        url: `${MONOREPO_URL}/commit/${verdict.commit}`,
      },
    ],
  };
  return { signals: [signal], metrics: [], changes: [] };
}
