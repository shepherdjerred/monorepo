/** Cluster reads and boot waits for sandbox pods, through the scoped kubectl. */
import { PAPER_DONE_PATTERN } from "#sandbox/paper-log.ts";
import type { Kubectl } from "./kubectl.ts";
import {
  MAIN_CONTAINER,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  SANDBOX_LABEL,
  STAGE_CONTAINER,
} from "./pod-manifest.ts";
import {
  assertStartable,
  type ClusterPod,
  PodListSchema,
  PodSchema,
  statusOf,
  unschedulableReason,
} from "./pod-state.ts";

export async function getPod(
  kubectl: Kubectl,
  pod: string,
): Promise<ClusterPod> {
  const { stdout } = await kubectl.run(["get", "pod", pod, "-o", "json"]);
  return PodSchema.parse(JSON.parse(stdout));
}

/** Every harness pod, keyed by sandbox id. */
export async function sandboxPods(
  kubectl: Kubectl,
): Promise<Map<string, ClusterPod>> {
  const { stdout } = await kubectl.run([
    "get",
    "pods",
    "-l",
    `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`,
    "-o",
    "json",
  ]);
  const pods = new Map<string, ClusterPod>();
  for (const pod of PodListSchema.parse(JSON.parse(stdout)).items) {
    const id = pod.metadata.labels?.[SANDBOX_LABEL];
    if (id !== undefined) {
      pods.set(id, pod);
    }
  }
  return pods;
}

/** `auth can-i` answers "no" with exit 1; either way the text explains. */
export async function canCreatePods(kubectl: Kubectl): Promise<string> {
  try {
    const { stdout } = await kubectl.run(["auth", "can-i", "create", "pods"]);
    return stdout;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function serverLogs(
  kubectl: Kubectl,
  pod: string,
): Promise<string> {
  const { stdout } = await kubectl.run(["logs", pod, "-c", MAIN_CONTAINER]);
  return stdout;
}

function pendingNote(pod: ClusterPod): string {
  const reason = unschedulableReason(pod);
  return reason === undefined ? "" : `: ${reason}`;
}

/** Waits for the stage init container to run (it then waits for STAGING_READY). */
export async function waitForStage(
  kubectl: Kubectl,
  pod: string,
  deadline: number,
  pollMs: number,
): Promise<void> {
  for (;;) {
    const status = await getPod(kubectl, pod);
    const stage = statusOf(
      status.status?.initContainerStatuses,
      STAGE_CONTAINER,
    );
    if (stage?.state?.running !== undefined) {
      return;
    }
    assertStartable(stage);
    if (stage?.state?.terminated !== undefined) {
      throw new Error(
        `The stage container exited before staging (${stage.state.terminated.reason ?? "unknown"})`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Pod ${pod} did not start staging before the deadline${pendingNote(status)}`,
      );
    }
    await Bun.sleep(pollMs);
  }
}

/** Waits for Paper's Done line; returns the log so far. */
export async function waitForDone(
  kubectl: Kubectl,
  pod: string,
  deadline: number,
  pollMs: number,
): Promise<string> {
  for (;;) {
    const status = await getPod(kubectl, pod);
    const phase = status.status?.phase;
    const main = statusOf(status.status?.containerStatuses, MAIN_CONTAINER);
    if (phase === "Failed" || phase === "Succeeded") {
      const tail = await serverLogs(kubectl, pod).catch(() => "");
      throw new Error(
        `Server exited before ready (${phase}):\n${tail.slice(-4000)}`,
      );
    }
    assertStartable(main);
    if (main?.state?.running !== undefined) {
      const logs = await serverLogs(kubectl, pod);
      if (PAPER_DONE_PATTERN.test(logs)) {
        return logs;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Server not ready before deadline:\n${logs.slice(-4000)}`,
        );
      }
    } else if (Date.now() > deadline) {
      throw new Error(
        `Pod ${pod} never started its server${pendingNote(status)}`,
      );
    }
    await Bun.sleep(pollMs);
  }
}
