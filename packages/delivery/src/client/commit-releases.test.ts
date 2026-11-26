import { describe, expect, it } from "vitest";
import type {
  CarriedFailure,
  CommitBlocker,
  CommitEnvironment,
  CommitStatus,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import type { CarriedRelease } from "#shared/hub/commit-release-contract.ts";
import { blockerNotes } from "./routes/commits/commit-blockers.ts";
import {
  commitStatement,
  environmentView,
  rowNotes,
  rowStanding,
} from "./routes/commits/commit-model.ts";
import {
  includedIntro,
  releasesNote,
} from "./routes/commits/commit-release.ts";

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
  outcome?: CarriedRelease["outcome"],
): CarriedRelease => ({
  service,
  revision,
  includedIn: full("f545a3b"),
  state,
  ...(outcome === undefined ? {} : { outcome }),
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

/** The services a commit built and passed on its own, and how many changed. */
const builtOf = (services: number, changed: number) => ({ services, changed });

const failedBuild = (title: string) => ({
  id: `${title}-build`,
  serviceId: title.toLowerCase(),
  sourceRevision: "3".repeat(40),
  sourceKind: "ci" as const,
  ciUrl: null,
  status: "failed" as const,
  qualificationReason: null,
  platformChanges: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  pipelineNumber: 1,
  links: [],
  serviceTitle: title,
});

/** Failed builds of the named services, each carried by bdf6689. */
const carriedOf = (titles: string[]) =>
  titles.map((title) => carried(title, "bdf6689"));

describe("a partially carried commit says what it built itself", () => {
  const trmnl = carried("TRMNL dashboard", "bdf6689");

  it("keeps Not built on its own for a commit with no build of its own", () => {
    // Wholly carried: every service went through the carrier.
    expect(
      rowNotes({ ...row, carriedFailures: [trmnl], built: builtOf(0, 0) }),
    ).toEqual([
      "Not built on its own; included in bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
    // A server that predates `built` says what it always said.
    expect(rowNotes({ ...row, carriedFailures: [trmnl] })).toEqual([
      "Not built on its own; included in bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
  });

  it("says which services the commit built itself and which a later commit built", () => {
    // /commits/8ebf9e8: 25 built on its own, 7 of them changed, TRMNL through bdf6689.
    expect(
      rowNotes({ ...row, carriedFailures: [trmnl], built: builtOf(25, 7) }),
    ).toEqual([
      "Built on its own for 25 services (7 changed); 1 service (TRMNL dashboard) was built by a later commit: included in bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
    // /commits/db787eb: two services through two carriers.
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 2,
        built: builtOf(13, 13),
        carriedFailures: [
          carried("Scout for LoL", "8ebf9e8"),
          carried("TRMNL dashboard", "bdf6689"),
        ],
      }),
    ).toEqual([
      "Built on its own for 13 services (13 changed); 2 services (Scout for LoL and TRMNL dashboard) were built by a later commit: included in 8ebf9e8 (whose build of Scout for LoL passed) and bdf6689 (whose build of TRMNL dashboard passed)",
    ]);
    expect(
      rowNotes({ ...row, carriedFailures: [trmnl], built: builtOf(1, 0) })[0],
    ).toMatch(/^Built on its own for 1 service \(0 changed\); 1 service \(/u);
  });

  const status = (
    built: { services: number; changed: number },
    titles: string[],
  ): CommitStatus => ({
    sha: full("8ebf9e8"),
    title: null,
    author: null,
    verdict: "nothing_to_deploy",
    buildId: "b",
    seenAt: null,
    environments: [],
    changed: [],
    unchangedCount: 0,
    built,
    failedBuilds: titles.map((title) => failedBuild(title)),
    carriedFailures: titles.map((title) => ({
      ...carried(title, "bdf6689"),
      buildId: `${title}-build`,
    })),
    pendingBuilds: [],
    blocker: null,
  });

  it("says the same in the headline", () => {
    expect(
      commitStatement(status({ services: 0, changed: 0 }, ["TRMNL"])),
    ).toBe(
      "Not built on its own; included in bdf6689 (whose build of TRMNL passed).",
    );
    expect(
      commitStatement(status({ services: 25, changed: 7 }, ["TRMNL"])),
    ).toBe(
      "Built on its own for 25 services (7 changed); 1 service (TRMNL) was built by a later commit: included in bdf6689 (whose build of TRMNL passed).",
    );
  });

  it("scopes the detail section to the services CI failed for, and agrees with the header", () => {
    // Partly carried: the failed service was built by a later commit, so the
    // section never says the commit was not built on its own.
    expect(includedIntro(carriedOf(["TRMNL dashboard"]), builtOf(25, 7))).toBe(
      "CI failed for TRMNL dashboard on this commit, so it was built by a later commit. A newer commit includes this one, and its build of the same service passed and published the change; that commit's releases, shown below, decide whether it is live.",
    );
    expect(
      includedIntro(
        carriedOf(["Scout for LoL", "TRMNL dashboard"]),
        builtOf(13, 13),
      ),
    ).toBe(
      "CI failed for Scout for LoL and TRMNL dashboard on this commit, so they were built by a later commit. A newer commit includes this one, and its build of each of them passed and published the change; that commit's releases, shown below, decide whether they are live.",
    );
    // Wholly carried: nothing was built here.
    expect(includedIntro(carriedOf(["CI (Woodpecker)"]), builtOf(0, 0))).toBe(
      "CI failed for CI (Woodpecker) on this commit, so it was not built on its own. A newer commit includes this one, and its build of the same service passed and published the change; that commit's releases, shown below, decide whether it is live.",
    );
    expect(includedIntro(carriedOf(["A"]), undefined)).toContain(
      "so it was not built on its own",
    );
  });
});

describe("releases a failed pipeline's carrier shipped", () => {
  it("counts and names each release by its own outcome, never flattened to superseded", () => {
    // /commits/f545a3b-carried: 6 failed then superseded, 2 canceled, 8 plainly superseded, 1 live.
    const failed = ["Arcade", "Golink", "Streambot & media", "A", "B", "C"].map(
      (name, index) => release(name, 10 + index, "superseded", "failed"),
    );
    const canceled = [
      release("Delivery", 324, "superseded", "canceled"),
      release("Starlight Karma Bot", 216, "superseded", "canceled"),
    ];
    const plain = Array.from({ length: 8 }, (_, index) =>
      release(`P${String(index)}`, 100 + index, "superseded"),
    );
    expect(
      releasesNote([
        ...plain,
        ...canceled,
        ...failed,
        release("Cluster observability baseline", 75, "live"),
      ]),
    ).toBe(
      "Releases in f545a3b: 6 failed and were superseded by newer releases, which are deployed (Arcade r10, Golink r11, Streambot & media r12 +3 more); 2 were canceled and superseded by newer releases, which are deployed (Delivery r324 and Starlight Karma Bot r216); 8 were superseded by newer releases, which are deployed (P0 r100, P1 r101, P2 r102 +5 more); Cluster observability baseline r75 is live",
    );
  });

  it("words a single release by its own outcome and treats a still-live one as live", () => {
    const only = (...releases: CarriedRelease[]) => releasesNote(releases);
    expect(only(release("Streambot & media", 346, "superseded"))).toBe(
      "Releases in f545a3b: Streambot & media r346 was superseded by a newer release, which is deployed",
    );
    expect(only(release("Golink", 12, "superseded", "failed"))).toBe(
      "Releases in f545a3b: Golink r12 failed and was superseded by a newer release, which is deployed",
    );
    expect(only(release("Delivery", 324, "superseded", "canceled"))).toBe(
      "Releases in f545a3b: Delivery r324 was canceled and superseded by a newer release, which is deployed",
    );
    // /commits/bdf6689: one release is still live, the rest superseded.
    expect(
      only(
        release("Starlight Karma Bot", 224, "live"),
        release("Hub", 287, "superseded"),
        release("Golink", 22, "superseded"),
      ),
    ).toBe(
      "Releases in f545a3b: 2 were superseded by newer releases, which are deployed (Hub r287 and Golink r22); Starlight Karma Bot r224 is live",
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
    const superseded = (status: "failed" | "canceled" | "succeeded") =>
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
    // A canceled deployment is not a failure: the row keeps the outcome.
    expect(
      rowStanding(
        { verdict: "deployed", environments: [superseded("canceled")] },
        [],
      ),
    ).toEqual({ status: "canceled", label: "Canceled, superseded" });
    // Failed in one environment and canceled in another: the failure leads.
    expect(
      rowStanding(
        {
          verdict: "deployed",
          environments: [superseded("canceled"), superseded("failed")],
        },
        [],
      ),
    ).toEqual({ status: "failed", label: "Failed, superseded" });
    // Canceled beside a deployed one: still canceled, never failed.
    expect(
      rowStanding(
        {
          verdict: "deployed",
          environments: [superseded("succeeded"), superseded("canceled")],
        },
        [],
      ).label,
    ).toBe("Canceled, superseded");
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
