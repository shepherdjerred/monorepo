import { safeHeartbeat } from "#activities/agent/agent-task-runtime.ts";
import { dispatchRenovateBundle } from "./dispatch.ts";
import { rankRenovateUpdates } from "./ranking.ts";
import { createRenovateStore } from "./store.ts";

export const renovateAutomationActivities = {
  async refreshRenovateRanking() {
    const ranking = await rankRenovateUpdates();
    await createRenovateStore().writeRanking(ranking);
    return {
      scannedAt: ranking.scannedAt,
      baseSha: ranking.baseSha,
      coverage: ranking.coverage,
      total: ranking.candidates.length,
    };
  },
  async dispatchRenovateBundle(
    input: Parameters<typeof dispatchRenovateBundle>[0],
  ) {
    safeHeartbeat({ phase: "renovate-dispatch" });
    const heartbeat = setInterval(() => {
      safeHeartbeat({ phase: "renovate-dispatch" });
    }, 15_000);
    try {
      return await dispatchRenovateBundle(input);
    } finally {
      clearInterval(heartbeat);
    }
  },
};
