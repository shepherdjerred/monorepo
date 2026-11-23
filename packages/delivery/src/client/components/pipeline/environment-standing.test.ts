import { describe, expect, it } from "vitest";
import type {
  PipelineStage,
  PipelineStatus,
  Transition,
} from "#shared/hub/hub-contract.ts";
import { environmentStanding } from "./environment-standing.ts";
import { ongoingWords } from "./stage-card.tsx";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function execution(revision: number) {
  return {
    buildId: null,
    versionSetId: VERSION_ID,
    revision,
    sourceRevision: null,
  };
}

/** The newest composed release, as the promotion page's version stage carries it. */
function versionStage(revision: number): PipelineStage {
  return {
    key: "version",
    kind: "version",
    title: "Version set",
    status: "succeeded",
    execution: execution(revision),
    environmentId: null,
    transition: null,
    actions: [],
  };
}

function environment(options: {
  id: string;
  accepted: number | null;
  newest?: number;
  status?: PipelineStatus;
  transition?: Partial<Transition>;
}): PipelineStage {
  return {
    key: `environment:${options.id}`,
    kind: "environment",
    title: options.id,
    status: options.status ?? "succeeded",
    execution: options.newest === undefined ? null : execution(options.newest),
    environmentId: options.id,
    transition: {
      mode: "automatic",
      enabled: true,
      sourceEnvironmentId: null,
      ...options.transition,
    },
    actions: [],
    accepted:
      options.accepted === null
        ? null
        : { versionSetId: VERSION_ID, revision: options.accepted },
  };
}

/** What an up-to-date r4 environment says when r5 is composed and arrives by `transition`. */
function ready(transition: Partial<Transition>) {
  return environmentStanding(
    environment({ id: "app/prod", accepted: 4, newest: 4, transition }),
    [versionStage(5)],
  )?.ready;
}

describe("environmentStanding", () => {
  it("says what runs, what the newest deployment did with another release, and what is ready", () => {
    const beta = environment({ id: "scout/beta", accepted: 322, newest: 322 });
    const prod = environment({
      id: "scout/prod",
      accepted: 274,
      newest: 293,
      status: "canceled",
      transition: { mode: "approval", sourceEnvironmentId: "scout/beta" },
    });
    const stages = [versionStage(322), beta, prod];
    expect(environmentStanding(prod, stages)).toEqual({
      facts: ["Accepted r274", "r293 canceled"],
      ready: { text: "r322 ready · needs approval", waitsForPerson: true },
    });
    expect(environmentStanding(beta, stages)).toEqual({
      facts: ["Accepted r322", "up to date"],
      ready: null,
    });
  });

  it("names how a ready release arrives", () => {
    expect(ready({ mode: "automatic" })).toEqual({
      text: "r5 ready · deploys automatically",
      waitsForPerson: false,
    });
    expect(ready({ mode: "automatic", enabled: false })?.text).toBe(
      "r5 ready · automatic deploys paused",
    );
    expect(ready({ mode: "manual" })?.text).toBe("r5 ready · release by hand");
    expect(ready({ mode: "promotion" })?.text).toBe(
      "r5 ready · promote by hand",
    );
  });

  it("lets a deployment under way speak for the release it delivers", () => {
    const deploying = environment({
      id: "app/prod",
      accepted: 4,
      newest: 5,
      status: "running",
    });
    expect(environmentStanding(deploying, [versionStage(5)])).toEqual({
      facts: ["Accepted r4", "r5 deploying"],
      ready: null,
    });
    // Until an executor claims it, the deployment is queued, as everywhere else.
    const queued = environment({
      id: "app/prod",
      accepted: 4,
      newest: 5,
      status: "queued",
    });
    expect(environmentStanding(queued, [versionStage(5)])).toEqual({
      facts: ["Accepted r4", "r5 queued"],
      ready: null,
    });
    const failed = environment({
      id: "app/prod",
      accepted: 4,
      newest: 5,
      status: "failed",
    });
    // Delivery does not retry a failed or canceled release on its own, so the
    // line must not promise it will, even on an automatic transition.
    expect(environmentStanding(failed, [versionStage(5)])).toEqual({
      facts: ["Accepted r4", "r5 failed"],
      ready: {
        text: "r5 will not deploy again on its own · retry or release by hand",
        waitsForPerson: true,
      },
    });
    const canceled = environment({
      id: "app/prod",
      accepted: 4,
      newest: 5,
      status: "canceled",
    });
    expect(environmentStanding(canceled, [versionStage(5)])?.ready).toEqual({
      text: "r5 will not deploy again on its own · retry or release by hand",
      waitsForPerson: true,
    });
  });

  it("says when nothing runs yet, and stays silent off the promotion page", () => {
    const empty = environment({ id: "app/prod", accepted: null });
    expect(environmentStanding(empty, [versionStage(1)])).toEqual({
      facts: ["Nothing accepted yet"],
      ready: {
        text: "r1 ready · deploys automatically",
        waitsForPerson: false,
      },
    });
    expect(environmentStanding(empty, [])).toEqual({
      facts: ["Nothing accepted yet"],
      ready: null,
    });
    const { accepted: _accepted, ...trace } = empty;
    expect(environmentStanding(trace, [])).toBeNull();
    expect(environmentStanding(versionStage(1), [])).toBeNull();
  });

  it("says what is accepted and what awaits approval, never running for both", () => {
    // Scout prod: r274 accepted, the promotion of r322 waiting on a person.
    const prod = environment({
      id: "scout/prod",
      accepted: 274,
      newest: 322,
      status: "awaiting_approval",
      transition: { mode: "approval", sourceEnvironmentId: "scout/beta" },
    });
    const beta = environment({ id: "scout/beta", accepted: 322, newest: 322 });
    const facts = environmentStanding(prod, [
      versionStage(322),
      beta,
      prod,
    ])?.facts;
    expect(facts).toEqual(["Accepted r274", "r322 awaiting approval"]);
    expect(facts?.join(" ")).not.toMatch(/running/iu);
  });
});

describe("what an unfinished action's clock measures", () => {
  it("says how long an action waited for a person or the queue, and running only for work under way", () => {
    expect(ongoingWords("awaiting_approval")).toBe("awaiting approval for");
    expect(ongoingWords("queued")).toBe("waiting for");
    expect(ongoingWords("pending")).toBe("waiting for");
    expect(ongoingWords("running")).toBe("running");
  });
});
