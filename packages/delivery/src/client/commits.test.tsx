import { describe, expect, it } from "vitest";
import type {
  CommitBlocker,
  CommitService,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import {
  blockerNotes,
  commitStatement,
  missingIdentity,
  parseSha,
  rowNotes,
  tallyText,
  unchangedLine,
  verdictView,
} from "./routes/commit-model.ts";

const NEWER = "69765c4ae8".padEnd(40, "0");

const build = (
  serviceId: string,
  outcome: "verified" | "failed",
  serviceTitle?: string,
) => ({
  id: `${serviceId}-build`,
  serviceId,
  sourceRevision: "3".repeat(40),
  sourceKind: "ci" as const,
  ciUrl: null,
  status: outcome,
  qualificationReason: null,
  platformChanges: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  pipelineNumber: 18_050,
  links: [],
  ...(serviceTitle === undefined ? {} : { serviceTitle }),
});

function changed(
  id: string,
  state: CommitService["environments"][number]["state"],
): CommitService {
  return {
    service: { id, title: id.toUpperCase(), kind: "product", links: [] },
    build: build(id, "verified"),
    versionSet: { id: `${id}/set`, revision: 5 },
    verdict:
      state === "live" || state === "superseded" ? "deployed" : "waiting",
    environments: [
      { environmentId: `${id}/prod`, name: "prod", state, deploymentId: null },
    ],
  };
}

/** The not-live environments of changed entries, as the server lists them. */
const blockersOf = (entries: CommitService[]): CommitBlocker[] =>
  entries.flatMap((entry) =>
    entry.environments
      .filter(
        (environment) =>
          environment.state !== "live" && environment.state !== "superseded",
      )
      .map((environment) => ({
        service: entry.service.title,
        environment: environment.name,
        state: environment.state,
      })),
  );

function status(overrides: Partial<CommitStatus>): CommitStatus {
  const base: CommitStatus = {
    sha: "3".repeat(40),
    title: null,
    author: null,
    verdict: "deployed",
    buildId: "b",
    seenAt: null,
    environments: [],
    changed: [],
    unchangedCount: 0,
    failedBuilds: [],
    pendingBuilds: [],
    blocker: null,
    ...overrides,
  };
  const blockers = overrides.blockers ?? blockersOf(base.changed);
  return { ...base, blockers, blocker: blockers[0] ?? null };
}

describe("commit statement", () => {
  it("does not contradict itself when CI failed for one service and newer commits carry the rest", () => {
    const statement = commitStatement(
      status({
        verdict: "build_failed",
        failedBuilds: [build("scout-frontend", "failed", "Scout frontend")],
        changed: ["media", "delivery", "scout"].map((id) =>
          changed(id, "superseded"),
        ),
      }),
    );
    expect(statement).toBe(
      "CI failed for Scout frontend, so Delivery published nothing for it. All 3 changed services are live because newer commits include them.",
    );
    expect(statement).not.toContain("nothing from this commit was published");
  });

  it("keeps the plain sentence when CI failed for everything", () => {
    expect(
      commitStatement(
        status({
          verdict: "build_failed",
          failedBuilds: [build("birmel", "failed", "Birmel")],
        }),
      ),
    ).toBe("CI failed, so nothing from this commit was published.");
  });

  it("says where a carried failure shipped, and that the carrier's build passed, not the carrier", () => {
    const failed = build("ci", "failed", "CI (Woodpecker)");
    const statement = commitStatement(
      status({
        verdict: "nothing_to_deploy",
        failedBuilds: [failed],
        carriedFailures: [
          {
            buildId: failed.id,
            includedIn: NEWER,
            serviceTitle: "CI (Woodpecker)",
          },
        ],
      }),
    );
    expect(statement).toBe(
      "CI failed for CI (Woodpecker) here, so it was not built on its own; included in 69765c4, whose build of CI (Woodpecker) passed.",
    );
    expect(statement).not.toContain("which passed");
    expect(statement).not.toContain("nothing from this commit was published");
    expect(statement).not.toContain("changed nothing");
  });

  it("leads with the real blocker, counted, before the carried CI failure", () => {
    // /commits/3dadb10: 19 of 20 services live, one waits on a manual release.
    const failed = build("scout-for-lol", "failed", "Scout for LoL");
    const statement = commitStatement(
      status({
        verdict: "waiting",
        failedBuilds: [failed],
        carriedFailures: [
          {
            buildId: failed.id,
            includedIn: NEWER,
            serviceTitle: "Scout for LoL",
          },
        ],
        changed: [
          changed("temporal-data", "manual"),
          ...Array.from({ length: 19 }, (_, position) =>
            changed(`service-${String(position)}`, "superseded"),
          ),
        ],
      }),
    );
    expect(statement).toBe(
      "1 of 20 changed services needs a manual release: TEMPORAL-DATA prod. 19 of 20 are live. CI failed for Scout for LoL here, so it was not built on its own; included in 69765c4, whose build of Scout for LoL passed.",
    );
  });

  it("still says CI failed for a failure nothing newer carries beside a more urgent verdict", () => {
    expect(
      commitStatement(
        status({
          verdict: "recovery_required",
          failedBuilds: [build("birmel", "failed", "Birmel")],
          changed: [changed("media", "recovery_required")],
        }),
      ),
    ).toBe(
      "Its changed service needs an operator to recover its environment: MEDIA prod. CI failed for Birmel, so Delivery published nothing for it.",
    );
  });

  it("names every environment held back the same way and counts services, not builds", () => {
    // /commits/0b3dde2: Minecraft failed in tsmc, the rest of prod is live.
    const minecraft: CommitService = {
      ...changed("minecraft", "failed"),
      environments: [
        {
          environmentId: "minecraft/sandbox",
          name: "sandbox",
          state: "live",
          deploymentId: null,
        },
        {
          environmentId: "minecraft/tsmc",
          name: "tsmc",
          state: "failed",
          deploymentId: null,
        },
      ],
    };
    const streambot = changed("streambot", "failed");
    expect(
      commitStatement(
        status({
          verdict: "failed",
          changed: [
            minecraft,
            streambot,
            changed("delivery", "live"),
            changed("tracker", "live"),
          ],
        }),
      ),
    ).toBe(
      "2 of 4 changed services failed to deploy: MINECRAFT tsmc and STREAMBOT prod. 2 of 4 are live.",
    );
  });

  it("accounts for every changed service: failed, awaiting approval, deploying and live add up to the total", () => {
    // /commits/72e4dff: 1 of 17 failed, 13 live, and three said nothing.
    const entries = [
      changed("minecraft", "failed"),
      changed("golink", "awaiting_approval"),
      changed("temporal", "awaiting_approval"),
      changed("scout", "deploying"),
      ...Array.from({ length: 13 }, (_, position) =>
        changed(`live-${String(position)}`, "live"),
      ),
    ];
    const statement = commitStatement(
      status({ verdict: "failed", changed: entries }),
    );
    expect(statement).toBe(
      "1 of 17 changed services failed to deploy: MINECRAFT prod. 2 need approval: GOLINK prod and TEMPORAL prod. 1 is deploying: SCOUT prod. 13 of 17 are live.",
    );
  });

  it("names up to three services per state, then how many more", () => {
    const entries = [
      ...["a", "b", "c", "d", "e"].map((id) =>
        changed(id, "awaiting_approval"),
      ),
      changed("f", "canceled"),
    ];
    expect(
      commitStatement(
        status({ verdict: "awaiting_approval", changed: entries }),
      ),
    ).toBe(
      "5 of 6 changed services need approval: A prod, B prod, C prod +2 more. 1 had its deployment canceled: F prod.",
    );
  });

  it("counts a service once, in its most urgent state, across its environments", () => {
    const split: CommitService = {
      ...changed("minecraft", "failed"),
      environments: [
        {
          environmentId: "minecraft/tsmc",
          name: "tsmc",
          state: "failed",
          deploymentId: null,
        },
        {
          environmentId: "minecraft/beta",
          name: "beta",
          state: "deploying",
          deploymentId: null,
        },
      ],
    };
    expect(
      commitStatement(status({ verdict: "failed", changed: [split] })),
    ).toBe("Its changed service failed to deploy: MINECRAFT tsmc.");
  });

  it("names the carrying release's own standing so it cannot contradict the carrier's row", () => {
    // /commits/f545a3b failed its deployment; the build of the commit it
    // carries passed CI. Saying only "build passed" contradicted its row.
    const failed = build("golink", "failed", "Golink");
    const statement = commitStatement(
      status({
        verdict: "failed",
        failedBuilds: [failed],
        carriedFailures: [
          {
            buildId: failed.id,
            includedIn: NEWER,
            serviceTitle: "Golink",
            releaseVerdict: "failed",
            releaseRevision: 347,
          },
        ],
        changed: [changed("golink", "failed")],
      }),
    );
    expect(statement).toContain(
      "included in 69765c4, whose build of Golink passed, but the change ships in release r347, which failed to deploy.",
    );
  });
});

describe("commit identity", () => {
  it("says nothing when the title and author were recorded", () => {
    expect(
      missingIdentity({
        title: "fix: x",
        author: "octocat",
        pipeline: undefined,
      }),
    ).toBeNull();
  });

  it("says plainly that a title was not captured when there is no stand-in", () => {
    expect(
      missingIdentity({ title: null, author: null, pipeline: undefined }),
    ).toBe("Title and author were not captured for this commit.");
    expect(
      missingIdentity({ title: "fix: x", author: null, pipeline: undefined }),
    ).toBe("Author was not captured for this commit.");
    expect(
      missingIdentity({ title: null, author: "octocat", pipeline: undefined }),
    ).toBe("Title was not captured for this commit.");
  });

  it("offers Woodpecker's stored pipeline as the stand-in, named as such", () => {
    expect(
      missingIdentity({
        title: null,
        author: null,
        pipeline: { number: 18_050, title: "feat(x): y", author: "octocat" },
      }),
    ).toBe(
      'Title and author were not captured for this commit. Woodpecker pipeline #18050 has the title "feat(x): y" and the author octocat.',
    );
    // Only what is missing is borrowed.
    expect(
      missingIdentity({
        title: "fix: x",
        author: null,
        pipeline: { number: 7, title: "other", author: "octocat" },
      }),
    ).toBe(
      "Author was not captured for this commit. Woodpecker pipeline #7 has the author octocat.",
    );
  });
});

/** A failed Golink build, carried by a newer commit whose release stands as given. */
const carriedRelease = (releaseVerdict: CommitVerdict) => [
  {
    buildId: "ci-build",
    includedIn: NEWER,
    serviceTitle: "Golink",
    releaseVerdict,
    releaseRevision: 347,
  },
];

/** A service held back in a prod environment, in a state. */
const holding = (service: string, state: CommitBlocker["state"]) => ({
  service,
  environment: "prod",
  state,
});

/** An environment whose newest deployment of the change failed. */
const failing = (service: string, environment: string): CommitBlocker => ({
  service,
  environment,
  state: "failed",
});

describe("commit row notes", () => {
  const row: CommitSummary = {
    sha: "3".repeat(40),
    title: null,
    author: null,
    verdict: "build_failed",
    seenAt: null,
    blocker: null,
    changedCount: 5,
    liveCount: 5,
    environments: [],
    buildId: "b",
    failedBuildCount: 1,
  };

  it("names the services whose CI failed beside the tallies", () => {
    expect(rowNotes({ ...row, failedServices: ["CI (Woodpecker)"] })).toEqual([
      "CI failed for CI (Woodpecker)",
    ]);
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 5,
        failedServices: ["A", "B", "C", "D", "E"],
      }),
    ).toEqual(["CI failed for A, B, C and 2 more"]);
    // A server that names none still counts them.
    expect(rowNotes(row)).toEqual(["CI failed for 1 service"]);
  });

  it("says a carried failure was included in the newer commit, whose build passed", () => {
    const carried = [
      { buildId: "ci-build", includedIn: NEWER, serviceTitle: "Golink" },
    ];
    expect(
      rowNotes({
        ...row,
        verdict: "nothing_to_deploy",
        carriedFailures: carried,
      }),
    ).toEqual([
      "Not built on its own; included in 69765c4, whose build of Golink passed",
    ]);
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 2,
        failedServices: ["Arcade"],
        carriedFailures: carried,
      }),
    ).toEqual([
      "CI failed for Arcade",
      "Not built on its own; included in 69765c4, whose build of Golink passed",
    ]);
  });

  it("names how the carrying release stands, so the row never says passed beside a failed carrier", () => {
    const passed =
      "Not built on its own; included in 69765c4, whose build of Golink passed";
    const expected: [CommitVerdict, string][] = [
      [
        "failed",
        `${passed}, but the change ships in release r347, which failed to deploy`,
      ],
      [
        "awaiting_approval",
        `${passed}, and the change ships in release r347, which awaits approval`,
      ],
      // A live release, or none yet: the pill says the rest.
      ["deployed", passed],
      ["waiting", passed],
    ];
    for (const [releaseVerdict, note] of expected)
      expect(
        rowNotes({
          ...row,
          verdict: "nothing_to_deploy",
          carriedFailures: carriedRelease(releaseVerdict),
        }),
      ).toEqual([note]);
  });

  it("names the blocking environment by its own words, never deploying when nothing is", () => {
    expect(
      rowNotes({
        ...row,
        verdict: "recovery_required",
        failedBuildCount: 0,
        blocker: {
          service: "Temporal",
          environment: "prod",
          state: "recovery_required",
        },
      }),
    ).toEqual(["Temporal / prod: recovery required"]);
  });

  it("names every failing environment, then how many more", () => {
    expect(
      blockerNotes([
        failing("Streambot", "prod"),
        failing("Minecraft", "tsmc"),
        { service: "Temporal", environment: "prod", state: "not_started" },
      ]),
    ).toEqual([
      "Streambot / prod: failed",
      "Minecraft / tsmc: failed",
      "Temporal / prod: not started",
    ]);
    expect(
      blockerNotes([
        failing("A", "prod"),
        failing("B", "prod"),
        failing("C", "prod"),
        failing("D", "prod"),
        failing("E", "beta"),
      ]),
    ).toEqual([
      "A / prod: failed",
      "B / prod: failed",
      "C / prod: failed",
      "+2 more failing",
    ]);
    // With nothing failing, every other state that holds services back.
    expect(
      blockerNotes([
        { service: "Birmel", environment: "prod", state: "manual" },
        { service: "Golink", environment: "prod", state: "not_started" },
      ]),
    ).toEqual([
      "Birmel / prod: needs manual release",
      "Golink / prod: not started",
    ]);
  });

  it("accounts for every state that holds services back, named up to three each", () => {
    expect(
      blockerNotes([
        holding("A", "awaiting_approval"),
        holding("B", "awaiting_approval"),
        holding("C", "deploying"),
        holding("D", "canceled"),
        holding("E", "canceled"),
        holding("F", "canceled"),
        holding("G", "canceled"),
      ]),
    ).toEqual([
      "2 need approval: A / prod and B / prod",
      "C / prod: deploying",
      "4 had their deployments canceled: D / prod, E / prod, F / prod +1 more",
    ]);
  });
});

describe("commit verdict and tallies", () => {
  it("shows a commit whose failures a newer commit carries as included, not nothing to deploy", () => {
    const carried = [{ buildId: "ci-build", includedIn: NEWER }];
    expect(verdictView("nothing_to_deploy", { carried })).toEqual({
      status: "not_started",
      label: "Included in newer",
    });
    expect(verdictView("nothing_to_deploy").label).toBe("Nothing to deploy");
  });

  it("names what a waiting commit waits on, and says not released only when no release includes it", () => {
    expect(verdictView("waiting", { pending: ["manual"] })).toEqual({
      status: "pending",
      label: "Needs manual release",
    });
    // The cause before what waits on it.
    expect(
      verdictView("waiting", { pending: ["waiting", "manual"] }).label,
    ).toBe("Needs manual release");
    expect(verdictView("waiting", { pending: ["not_started"] }).label).toBe(
      "Not started",
    );
    expect(
      verdictView("waiting", {
        carried: [{ buildId: "ci-build", includedIn: NEWER }],
      }).label,
    ).toBe("Not released");
    // Other verdicts keep their own words.
    expect(verdictView("failed", { pending: ["failed"] }).label).toBe("Failed");
  });

  it("explains an environment tally in short on screen and in full to a screen reader", () => {
    expect(tallyText({ name: "prod", liveCount: 14, total: 19 })).toEqual({
      short: "prod 14/19 live",
      full: "prod: 14 of 19 changed services live",
    });
    expect(tallyText({ name: "beta", liveCount: 1, total: 1 }).full).toBe(
      "beta: 1 of 1 changed service live",
    );
  });
});

describe("commit finder and counts", () => {
  it("trims a pasted SHA and refuses anything but 7 to 40 hex digits", () => {
    expect(parseSha("  0F18E58\n")).toBe("0f18e58");
    expect(parseSha("0f18e5")).toBeNull();
    expect(parseSha("not-a-sha")).toBeNull();
  });

  it("counts the unchanged services in good grammar", () => {
    expect(unchangedLine(1)).toBe(
      "1 other service built with nothing to deploy.",
    );
    expect(unchangedLine(3)).toBe(
      "3 other services built with nothing to deploy.",
    );
  });
});
