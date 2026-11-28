import { BatchV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { runDeliveryJobCommand } from "#scripts/jobs/run-delivery-job.ts";
import { DeliveryJobFailedError, runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import { DELIVERY_JOB_RESULT_PREFIX } from "#shared/delivery-job.ts";
import {
  queryRolloutMetric,
  requireAcceptedWorkerDeployment,
  type RolloutCommandRunner,
} from "#lib/worker-deployment-proofs.ts";
import { CANDIDATE, STABLE, temporal } from "./model-worker-fixture.ts";
import { stepDeliveryWorkerRollout } from "./worker-rollout.ts";

const timestamp = "2026-11-15T05:09:39.000Z";

function workerVerifyDetailFixture() {
  return temporal([], []);
}

describe("worker-verify failure diagnostics (AI-642)", () => {
  it("runDeliveryJobCommand retains bounded secret-redacted stderr/stdout on non-zero exit", async () => {
    const secretToken = "super-secret-token-value-12345";
    await expect(
      runDeliveryJobCommand(
        [
          "sh",
          "-c",
          `echo "stdout context"; echo "dial tcp: token=${secretToken} deadline exceeded" >&2; exit 2`,
        ],
        { env: { ...Bun.env, DELIVERY_EXECUTOR_TOKEN: secretToken } },
      ),
    ).rejects.toThrow(
      /Reviewed worker proof or routing command failed \(sh -c .*exit 2\): dial tcp: token=\*\*\* deadline exceeded\nstdout context/u,
    );
  });

  it("runDeliveryJobCommand retries transient Prometheus HTTP 503/network errors up to 3 attempts", async () => {
    let attempts = 0;
    const result = await runDeliveryJobCommand(
      ["toolkit", "prom", "query", "up", "--output", "json"],
      {
        retryDelayMs: 1,
        fetchImpl: async () => {
          attempts++;
          if (attempts === 1) throw new TypeError("fetch failed: EAI_AGAIN");
          return attempts === 2
            ? new Response("upstream unavailable", { status: 503 })
            : new Response('{"status":"success"}', { status: 200 });
        },
      },
    );
    expect(attempts).toBe(3);
    expect(result.stdout).toBe('{"status":"success"}');
  });

  it("runDeliveryJob attaches the failed Pod's redacted stage log tail to DeliveryJobFailedError", async () => {
    const secret = "top-secret-bearer-value-9999";
    vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", secret);
    try {
      const request = {
        deploymentId: "dep/642",
        stageKey: "worker-verify",
        recipe: "worker-step" as const,
        runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"c".repeat(64)}`,
        sourceRevision: CANDIDATE,
        input: { action: "verify" },
      };
      const manifest = deliveryJobManifest(request);
      const jobUid = "99999999-9999-4999-8999-999999999999";
      const failedJob = structuredClone(manifest);
      failedJob.metadata!.uid = jobUid;
      failedJob.status = {
        active: 0,
        conditions: [{ type: "Failed", status: "True" }],
      };
      const kubernetes = new KubeConfig();
      const fakeMakeApiClient: any = (apiType: unknown) => {
        if (apiType === BatchV1Api) {
          return {
            readNamespacedJob: vi.fn(async () => failedJob),
            createNamespacedJob: vi.fn(async () => failedJob),
          };
        }
        if (apiType === CoreV1Api) {
          return {
            listNamespacedPod: vi.fn(async () => ({
              items: [
                {
                  metadata: {
                    name: "delivery-pod-1",
                    ownerReferences: [{ kind: "Job", uid: jobUid }],
                  },
                },
              ],
            })),
            readNamespacedPodLog: vi.fn(
              async () =>
                `describe-version dial failed with auth=${secret}\n${DELIVERY_JOB_RESULT_PREFIX}{"ignored":true}`,
            ),
          };
        }
        throw new Error("Unexpected client");
      };
      vi.spyOn(kubernetes, "makeApiClient").mockImplementation(
        fakeMakeApiClient,
      );

      const failure = await runDeliveryJob(
        request,
        () => Promise.resolve(),
        undefined,
        {
          kubernetes,
          heartbeat: vi.fn(),
          cancellationSignal: new AbortController().signal,
        },
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DeliveryJobFailedError);
      const message = failure instanceof Error ? failure.message : "";
      expect(message).toContain(
        "Delivery Job failed; inspect its recorded UID and bounded stage logs",
      );
      expect(message).toContain("describe-version dial failed with auth=***");
      expect(message).not.toContain(secret);
      expect(message).not.toContain(DELIVERY_JOB_RESULT_PREFIX);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("worker-verify read-only retries (AI-642)", () => {
  it("retries transient describe, describe-version, and prom query failures in worker-verify without retrying mutations", async () => {
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue();
    try {
      let promCalls = 0;
      const value = await queryRolloutMetric(
        "vector(1)",
        "poller",
        async () => {
          if (++promCalls < 3) throw new Error("transient prom ECONNRESET");
          return {
            stdout: JSON.stringify({
              status: "success",
              data: { resultType: "vector", result: [{ value: [1, "2"] }] },
            }),
            stderr: "",
          };
        },
      );
      expect(value).toBe(2);
      expect(promCalls).toBe(3);

      let describeAcceptCalls = 0;
      await requireAcceptedWorkerDeployment(
        {
          address: "temporal.test:7233",
          namespace: "beta",
          buildId: CANDIDATE,
          deploymentName: "scout-beta-workflows",
          taskQueue: "scout-workflows",
        },
        async (argv) => {
          if (argv.includes("describe")) {
            if (++describeAcceptCalls < 2) throw new Error("dial timeout");
            return {
              stdout: JSON.stringify({
                name: "scout-beta-workflows",
                routingConfig: {
                  currentVersionBuildID: CANDIDATE,
                  rampingVersionBuildID: "",
                  rampingVersionPercentage: 0,
                },
              }),
              stderr: "",
            };
          }
          return {
            stdout: JSON.stringify({
              status: "success",
              data: { resultType: "vector", result: [{ value: [1, "1"] }] },
            }),
            stderr: "",
          };
        },
      );
      expect(describeAcceptCalls).toBe(2);

      const detail = workerVerifyDetailFixture();
      let describeVersionFailures = 0;
      let describeFailures = 0;
      const run: RolloutCommandRunner = async (argv) => {
        if (argv[0] === "git")
          return {
            stdout: argv[1] === "rev-parse" ? CANDIDATE : "",
            stderr: "",
          };
        if (argv[0] === "bun") return { stdout: "ok", stderr: "" };
        if (argv[1] === "prom") {
          return {
            stdout: JSON.stringify({
              status: "success",
              data: { resultType: "vector", result: [{ value: [1, "1"] }] },
            }),
            stderr: "",
          };
        }
        if (argv.includes("describe-version")) {
          if (describeVersionFailures < 2) {
            describeVersionFailures++;
            throw new Error("transient gRPC dial timeout");
          }
          return {
            stdout: JSON.stringify({
              BuildID: CANDIDATE,
              taskQueuesInfos: [
                { name: "monorepo-workflows", type: "workflow" },
                { name: "delivery-workflows", type: "workflow" },
              ],
            }),
            stderr: "",
          };
        }
        if (argv.includes("describe")) {
          if (describeFailures < 1) {
            describeFailures++;
            throw new Error("transient gRPC dial timeout");
          }
          return {
            stdout: JSON.stringify({
              name: "monorepo-central-workflows",
              versionSummaries: [{ BuildID: CANDIDATE, createTime: timestamp }],
              routingConfig: {
                currentVersionBuildID: CANDIDATE,
                rampingVersionBuildID: "",
                rampingVersionPercentage: 0,
                currentVersionChangedTime: timestamp,
                rampingVersionChangedTime: timestamp,
                rampingVersionPercentageChangedTime: timestamp,
              },
            }),
            stderr: "",
          };
        }
        throw new Error(`Unexpected command: ${argv.join(" ")}`);
      };
      const receipt = await stepDeliveryWorkerRollout(
        {
          detail,
          action: "verify",
          connection: { address: "temporal.test:7233" },
          plan: {
            target: "central",
            namespace: "prod",
            deploymentName: "monorepo-central-workflows",
            taskQueue: "monorepo-workflows",
            candidateBuildId: CANDIDATE,
            candidateImage: `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`,
            expectedCurrentBuildId: STABLE,
            routes: [
              { namespace: "prod", expectedCurrentBuildId: STABLE },
              { namespace: "beta", expectedCurrentBuildId: STABLE },
            ],
            deploymentId: detail.deployment.id,
          },
        },
        run,
      );
      expect(receipt.currentBuildId).toBe(CANDIDATE);
      expect(describeVersionFailures).toBe(2);
      expect(describeFailures).toBe(1);
    } finally {
      sleep.mockRestore();
    }
  });
});
