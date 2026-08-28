import { describe, expect, test } from "vitest";
import {
  buildExecutionMetadata,
  executionDomainForTaskQueue,
  parseTemporalBootstrapMetadata,
} from "./execution-metadata.ts";
import { TASK_QUEUES } from "./task-queues.ts";

const RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("central Temporal execution metadata", () => {
  test("maps every task queue to an execution domain", () => {
    expect(executionDomainForTaskQueue(TASK_QUEUES.HOME)).toBe("home");
    expect(executionDomainForTaskQueue(TASK_QUEUES.REPORTS)).toBe("reports");
    expect(executionDomainForTaskQueue(TASK_QUEUES.INFRA)).toBe("infra");
    expect(executionDomainForTaskQueue(TASK_QUEUES.REPO_AUTOMATION)).toBe(
      "repo",
    );
    expect(executionDomainForTaskQueue(TASK_QUEUES.SCOUT)).toBe("scout");
    expect(executionDomainForTaskQueue(TASK_QUEUES.AGENT_TASK)).toBe("agent");
    expect(executionDomainForTaskQueue(TASK_QUEUES.GLITTER_CORPUS)).toBe(
      "glitter",
    );
    expect(executionDomainForTaskQueue(TASK_QUEUES.MAINTENANCE)).toBe(
      "maintenance",
    );
    expect(executionDomainForTaskQueue(TASK_QUEUES.DEFAULT)).toBe("platform");
  });

  test("uses a Scout stage as the execution environment", () => {
    const bootstrap = parseTemporalBootstrapMetadata("prod", RELEASE_COMMIT);
    expect(
      buildExecutionMetadata({
        bootstrap,
        taskQueue: TASK_QUEUES.SCOUT_BETA,
        trigger: "schedule",
      }).Environment,
    ).toBe("beta");
  });

  test("normalizes the central production bootstrap name", () => {
    expect(
      parseTemporalBootstrapMetadata("production", RELEASE_COMMIT).environment,
    ).toBe("prod");
  });

  test("fails fast on missing bootstrap metadata", () => {
    expect(() =>
      parseTemporalBootstrapMetadata(undefined, undefined),
    ).toThrow();
  });
});
