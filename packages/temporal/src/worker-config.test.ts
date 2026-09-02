import { describe, expect, it } from "vitest";
import { agentActivities, reportActivities } from "./activities/index.ts";
import { TASK_QUEUES } from "./shared/task-queues.ts";
import {
  getWorkerRoleContract,
  QUEUE_WORKER_DEFINITIONS,
  type QueueWorkerRole,
} from "./worker-config.ts";

const ACTIVITY_TASK_QUEUES = Object.values(TASK_QUEUES).filter(
  (taskQueue) =>
    taskQueue !== TASK_QUEUES.WORKFLOWS &&
    taskQueue !== TASK_QUEUES.SCOUT_BETA &&
    taskQueue !== TASK_QUEUES.SCOUT_PROD,
);

function activityNamesFor(
  role: Exclude<QueueWorkerRole, "workflows">,
): string[] {
  const definition = QUEUE_WORKER_DEFINITIONS.find(
    (candidate) => candidate.role === role,
  );
  if (definition?.kind !== "activity") {
    throw new Error(`Missing Activity Worker definition for ${role}`);
  }
  return Object.keys(definition.activities);
}

describe("Temporal worker role contracts", () => {
  it("assigns every Activity queue to exactly one capability role", () => {
    const ownershipCounts = new Map<string, number>();
    for (const definition of QUEUE_WORKER_DEFINITIONS.filter(
      (candidate) => candidate.kind === "activity",
    )) {
      ownershipCounts.set(
        definition.taskQueue,
        (ownershipCounts.get(definition.taskQueue) ?? 0) + 1,
      );
    }

    expect(
      [...ownershipCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ).toEqual(
      ACTIVITY_TASK_QUEUES.sort((left, right) => left.localeCompare(right)).map(
        (taskQueue) => [taskQueue, 1],
      ),
    );
  });

  it("polls only the canonical Workflow queue", () => {
    const workflowDefinitions = getWorkerRoleContract("workflows").workers;
    expect(
      workflowDefinitions.every((definition) => definition.kind === "workflow"),
    ).toBe(true);
    expect(
      workflowDefinitions.map((definition) => definition.taskQueue),
    ).toEqual([TASK_QUEUES.WORKFLOWS]);
  });

  it("preserves the Glitter alias", () => {
    expect(
      getWorkerRoleContract("glitter").workers.map(
        (definition) => definition.taskQueue,
      ),
    ).toEqual([TASK_QUEUES.GLITTER_CORPUS, TASK_QUEUES.GLITTER_CONTEXT]);
  });

  it("keeps embedded Scout Workflow queues out of central workers", () => {
    expect(
      getWorkerRoleContract("scout").workers.map(
        (definition) => definition.taskQueue,
      ),
    ).toEqual([TASK_QUEUES.SCOUT]);
    expect(
      QUEUE_WORKER_DEFINITIONS.some(
        (definition) =>
          definition.taskQueue === TASK_QUEUES.SCOUT_BETA ||
          definition.taskQueue === TASK_QUEUES.SCOUT_PROD,
      ),
    ).toBe(false);
  });

  it("keeps gateway and event-bridge ownership explicit", () => {
    expect(getWorkerRoleContract("control")).toMatchObject({
      runsGateway: true,
      validatesScheduleEnvironmentLocally: false,
      runsEventBridge: false,
      workers: [],
    });
    expect(getWorkerRoleContract("home")).toMatchObject({
      runsGateway: false,
      runsEventBridge: true,
    });
  });

  it("runs every canonical queue and control surface locally", () => {
    const contract = getWorkerRoleContract("all");
    expect(contract.workers).toHaveLength(ACTIVITY_TASK_QUEUES.length + 1);
    expect(contract.runsGateway).toBe(true);
    expect(contract.validatesScheduleEnvironmentLocally).toBe(true);
    expect(contract.runsEventBridge).toBe(true);
    expect(contract.restoresGlitterCorpusMetrics).toBe(true);
    expect(contract.restoresSeaweedFsBackupMetrics).toBe(true);
  });

  it("applies the planned activity concurrency by domain", () => {
    const concurrency = new Map(
      QUEUE_WORKER_DEFINITIONS.filter(
        (definition) => definition.kind === "activity",
      ).map((definition) => [
        definition.role,
        definition.maxConcurrentActivityTaskExecutions,
      ]),
    );
    expect(concurrency.get("home")).toBe(4);
    expect(concurrency.get("reports")).toBe(4);
    const serialRoles: Exclude<QueueWorkerRole, "workflows">[] = [
      "agent",
      "backup",
      "billing",
      "glitter-context",
      "glitter-corpus",
      "infra",
      "maintenance",
      "repo",
      "scout",
    ];
    for (const serialRole of serialRoles) {
      expect(concurrency.get(serialRole)).toBe(1);
    }
  });

  it("dispatches GoLink cluster reads only through infra", () => {
    expect(activityNamesFor("infra")).toContain("listTailscaleIngresses");
    expect(activityNamesFor("repo")).not.toContain("listTailscaleIngresses");
  });

  it("dispatches CI I/O observability only through infra", () => {
    expect(activityNamesFor("infra")).toContain("collectCiIoImpact");
    expect(activityNamesFor("repo")).not.toContain("collectCiIoImpact");
  });

  it("keeps report delivery capabilities separate from agent execution", () => {
    expect(reportActivities.sendAgentTaskEmail).toBe(
      agentActivities.sendAgentTaskEmail,
    );
    expect(reportActivities.sendAgentTaskFailureReport).toBe(
      agentActivities.sendAgentTaskFailureReport,
    );
    expect(reportActivities).not.toHaveProperty("runAgentTask");
    expect(reportActivities).not.toHaveProperty("prepareAgentTaskWorkdir");
  });
});
