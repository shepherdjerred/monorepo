import { describe, expect, it } from "vitest";
import type {
  CarriedFailure,
  CommitBlocker,
  CommitEnvironment,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import type { CarriedRelease } from "#shared/hub/commit-release-contract.ts";
import { blockerNotes } from "./routes/commits/commit-blockers.ts";
import {
  environmentView,
  rowNotes,
  rowStanding,
} from "./routes/commits/commit-model.ts";
import { releasesNote } from "./routes/commits/commit-release.ts";

const full = (short: string) => short.padEnd(40, "0");

const row: CommitSummary = {
  sha: full("72e4dff"),
  title: null,
  author: null,
  verdict: "nothing_to_deploy",
  seenAt: null,
  blocker: null,
  changedCount: 17,
  liveCount: 17,
  environments: [],
  buildId: "b",
  failedBuildCount: 1,
};

const carried = (
  serviceTitle: string,
  includedIn: string,
  extra: Partial<CarriedFailure> = {},
): CarriedFailure => ({
  buildId: `${serviceTitle}-build`,
  includedIn: full(includedIn),
  serviceTitle,
  ...extra,
});

/** A release of a failed pipeline's change, built by f545a3b. */
const release = (
  service: string,
  revision: number,
  state: CarriedRelease["state"],
): CarriedRelease => ({
  service,
  revision,
  includedIn: full("f545a3b"),
  state,
});

/** A service held back in one environment, in a state. */
const held = (
  service: string,
  environmentName: string,
  state: CommitBlocker["state"],
): CommitBlocker => ({ service, environment: environmentName, state });

describe("carrying commits as a list", () => {
  it("writes each carrying commit with its own parenthesis, never a run-on clause", () => {
    // db787eb: Scout carried by 8ebf9e8, TRMNL dashboard by bdf6689.
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 2,
        carriedFailures: [
          carried("Scout for LoL", "8ebf9e8"),
          carried("TRMNL dashboard", "bdf6689"),
        ],
      }),
    ).toEqual([
      "Not built on its own; included in 8ebf9e8 (whose build of Scout for LoL passed) and bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
    // Three commits read as a proper series.
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 3,
        carriedFailures: [
          carried("A", "1111111"),
          carried("B", "2222222"),
          carried("C", "3333333"),
        ],
      }),
    ).toEqual([
      "Not built on its own; included in 1111111 (whose build of A passed), 2222222 (whose build of B passed) and 3333333 (whose build of C passed)",
    ]);
  });

  it("says where the carrying commit stands itself when it is not settled", () => {
    // 8ebf9e8 is carried by bdf6689, which awaits approval.
    expect(
      rowNotes({
        ...row,
        carriedFailures: [
          carried("TRMNL dashboard", "bdf6689", {
            includedInVerdict: "awaiting_approval",
          }),
        ],
      }),
    ).toEqual([
      "Not built on its own; included in bdf6689 (whose build of TRMNL dashboard passed; bdf6689 itself awaits approval)",
    ]);
    // A deployed or idle carrier adds nothing.
    expect(
      rowNotes({
        ...row,
        carriedFailures: [
          carried("TRMNL dashboard", "bdf6689", {
            includedInVerdict: "deployed",
          }),
        ],
      }),
    ).toEqual([
      "Not built on its own; included in bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
  });
});

describe("releases a failed pipeline's carrier shipped", () => {
  it("names the superseded and live releases the blockers do not", () => {
    // /commits/72e4dff: Minecraft r117 failed (a blocker); these landed.
    expect(
      releasesNote([
        release("Streambot & media", 346, "superseded"),
        release("Delivery execution control plane", 171, "superseded"),
        release("Golink", 12, "superseded"),
        release("Hub", 278, "superseded"),
        release("Cluster observability baseline", 75, "live"),
      ]),
    ).toBe(
      "Releases in f545a3b: 4 were superseded by newer releases, which are deployed (Streambot & media r346, Delivery execution control plane r171, Golink r12 +1 more), Cluster observability baseline r75 is live",
    );
    expect(
      releasesNote([release("Streambot & media", 346, "superseded")]),
    ).toBe(
      "Releases in f545a3b: Streambot & media r346 was superseded by a newer release, which is deployed",
    );
    expect(releasesNote([])).toBeNull();
    expect(releasesNote(undefined)).toBeNull();
  });

  it("appears in the list row beside the blockers and the carrier", () => {
    expect(
      rowNotes({
        ...row,
        carriedFailures: [carried("CI (Woodpecker)", "f545a3b")],
        carriedReleases: [release("Golink", 12, "superseded")],
        blockers: [
          { service: "Minecraft", environment: "tsmc", state: "failed" },
        ],
        blocker: { service: "Minecraft", environment: "tsmc", state: "failed" },
      }),
    ).toEqual([
      "Not built on its own; included in f545a3b (whose build of CI (Woodpecker) passed)",
      "Releases in f545a3b: Golink r12 was superseded by a newer release, which is deployed",
      "Minecraft / tsmc: failed",
    ]);
  });
});

const environment = (
  state: CommitEnvironment["state"],
  landed?: CommitEnvironment["release"],
): CommitEnvironment => ({
  environmentId: "streambot/prod",
  name: "prod",
  state,
  deploymentId: null,
  ...(landed === undefined ? {} : { release: landed }),
});

describe("a row that names a release shows that release's own state", () => {
  it("says superseded by the accepted release, not Deployed", () => {
    // /commits/72e4dff: Streambot & media r346 via f545a3b.
    expect(
      environmentView(
        environment("superseded", {
          revision: 346,
          status: "succeeded",
          supersededBy: 381,
        }),
      ),
    ).toEqual({
      status: "succeeded",
      label: "superseded by r381, which is deployed",
    });
  });

  it("says first that the release failed or was canceled", () => {
    expect(
      environmentView(
        environment("superseded", {
          revision: 346,
          status: "failed",
          supersededBy: 381,
        }),
      ),
    ).toEqual({
      status: "failed",
      label: "failed, superseded by r381, which is deployed",
    });
    expect(
      environmentView(
        environment("superseded", {
          revision: 12,
          status: "canceled",
          supersededBy: 13,
        }),
      ).label,
    ).toBe("canceled, superseded by r13, which is deployed");
  });

  it("leaves live, failed and unknown chips as they were", () => {
    expect(environmentView(environment("live")).label).toBe("live");
    expect(
      environmentView(
        environment("failed", { revision: 117, status: "failed" }),
      ).label,
    ).toBe("failed");
    // A server that predates the release field.
    expect(environmentView(environment("superseded")).label).toBe(
      "live (newer)",
    );
  });

  it("gives the service row the release's standing, not the service's", () => {
    const superseded = (status: "failed" | "succeeded") =>
      environment("superseded", { revision: 346, status, supersededBy: 381 });
    expect(
      rowStanding(
        { verdict: "deployed", environments: [superseded("failed")] },
        [],
      ),
    ).toEqual({ status: "failed", label: "Failed, superseded" });
    expect(
      rowStanding(
        { verdict: "deployed", environments: [superseded("succeeded")] },
        [],
      ),
    ).toEqual({ status: "succeeded", label: "Superseded" });
    // Live in one environment: the service's own verdict stands.
    expect(
      rowStanding(
        {
          verdict: "deployed",
          environments: [superseded("failed"), environment("live")],
        },
        [],
      ).label,
    ).toBe("Deployed");
  });
});

describe("a tally short of all live has a service named behind it", () => {
  it("names the prod environment a service waits in while its beta deploys", () => {
    // /commits/e02b8ee: prod 1/2 live, beta 0/1, only Scout / beta named.
    expect(
      blockerNotes([
        held("Scout for LoL", "beta", "queued"),
        held("Scout for LoL", "prod", "waiting"),
      ]),
    ).toEqual([
      "Scout for LoL / beta: queued",
      "Scout for LoL / prod: waiting for earlier stage",
    ]);
  });

  it("counts services, not environments, in the extra group", () => {
    expect(
      blockerNotes([
        held("A", "beta", "queued"),
        held("B", "beta", "queued"),
        held("A", "prod", "waiting"),
        held("B", "prod", "waiting"),
      ]),
    ).toEqual([
      "2 are queued: A / beta and B / beta",
      "2 wait for an earlier stage: A / prod and B / prod",
    ]);
  });
});
