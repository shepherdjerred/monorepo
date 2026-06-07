import { proxyActivities } from "@temporalio/workflow";
import type {
  PokeemeraldWasmActivities,
  PokeemeraldWasmUpdateResult,
} from "#activities/pokeemerald-wasm.ts";

const { updatePokeemeraldWasm } = proxyActivities<PokeemeraldWasmActivities>({
  // Long: clones the monorepo, downloads the ~12 MB wasm, pushes + opens a PR.
  // Heartbeats fire every 10s (see pokeemerald-wasm.ts) so worker death
  // surfaces in <60s.
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "1 minute",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
});

export async function runPokeemeraldWasmUpdate(): Promise<PokeemeraldWasmUpdateResult> {
  return await updatePokeemeraldWasm();
}
