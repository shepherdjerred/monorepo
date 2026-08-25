import { describe, expect, it } from "vitest";
import { agentActivities, reportActivities } from "./activities/index.ts";
import { TASK_QUEUES } from "./shared/task-queues.ts";
import {
  getWorkerRoleContract,
  QUEUE_WORKER_DEFINITIONS,
  type QueueWorkerRole,
} from "./worker-config.ts";

describe("Temporal worker role contracts", () => {
  it("assigns every queue to exactly one canonical role", () => {
    const ownershipCounts = new Map<string, number>();
    for (const definition of QUEUE_WORKER_DEFINITIONS) {
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
      Object.values(TASK_QUEUES)
        .sort((left, right) => left.localeCompare(right))
        .map((taskQueue) => [taskQueue, 1]),
    );
  });

  it("preserves the production core and Glitter aliases", () => {
    expect(
      getWorkerRoleContract("core").workers.map(
        (definition) => definition.taskQueue,
      ),
    ).toEqual([TASK_QUEUES.DEFAULT]);
    expect(
      getWorkerRoleContract("glitter").workers.map(
        (definition) => definition.taskQueue,
      ),
    ).toEqual([TASK_QUEUES.GLITTER_CORPUS, TASK_QUEUES.GLITTER_CONTEXT]);
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
    expect(getWorkerRoleContract("legacy")).toMatchObject({
      runsGateway: false,
      runsEventBridge: false,
    });
  });

  it("runs every canonical queue and control surface locally", () => {
    const contract = getWorkerRoleContract("all");
    expect(contract.workers).toHaveLength(Object.values(TASK_QUEUES).length);
    expect(contract.runsGateway).toBe(true);
    expect(contract.validatesScheduleEnvironmentLocally).toBe(true);
    expect(contract.runsEventBridge).toBe(true);
    expect(contract.restoresGlitterCorpusMetrics).toBe(true);
  });

  it("applies the planned activity concurrency by domain", () => {
    const concurrency = new Map(
      QUEUE_WORKER_DEFINITIONS.map((definition) => [
        definition.role,
        definition.maxConcurrentActivityTaskExecutions,
      ]),
    );
    expect(concurrency.get("home")).toBe(4);
    expect(concurrency.get("reports")).toBe(4);
    const serialRoles: QueueWorkerRole[] = [
      "agent",
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
    expect(concurrency.get("legacy")).toBe(1);
  });

  it("dispatches GoLink cluster reads only through infra", () => {
    const infra = QUEUE_WORKER_DEFINITIONS.find(
      (definition) => definition.role === "infra",
    );
    const repo = QUEUE_WORKER_DEFINITIONS.find(
      (definition) => definition.role === "repo",
    );
    expect(Object.keys(infra?.activities ?? {})).toContain(
      "listTailscaleIngresses",
    );
    expect(Object.keys(repo?.activities ?? {})).not.toContain(
      "listTailscaleIngresses",
    );
  });

  it("dispatches CI I/O observability only through infra", () => {
    const infra = QUEUE_WORKER_DEFINITIONS.find(
      (definition) => definition.role === "infra",
    );
    const repo = QUEUE_WORKER_DEFINITIONS.find(
      (definition) => definition.role === "repo",
    );
    expect(Object.keys(infra?.activities ?? {})).toContain("collectCiIoImpact");
    expect(Object.keys(repo?.activities ?? {})).not.toContain(
      "collectCiIoImpact",
    );
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
