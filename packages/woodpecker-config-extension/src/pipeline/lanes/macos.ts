import type { CiStep } from "#src/pipeline/model.ts";
import { LIGHT_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * Native macOS lanes.
 *
 * Swift, Xcode, and the signed UI tests cannot run in a Linux container, so
 * these are the only steps that leave the cluster. They run on the Mac through
 * Woodpecker's local backend, which executes commands directly on the host as
 * the logged-in user -- no container, no isolation.
 *
 * That trust boundary is the same one the Buildkite mac agent had, and the
 * same mitigations apply:
 *
 * - They never run for fork pull requests. Woodpecker enforces this at the
 *   repository level ("Approvals for forked repositories", plus `ignore_forks`
 *   on this repo), which replaces the `!build.pull_request.repository.fork`
 *   guard each Buildkite step carried individually.
 * - They hold no credentials. There is no pod, so there are no Kubernetes
 *   secret grants, and nothing here needs one.
 * - They are globally serialized: one Mac, one job at a time.
 *
 * `macos-native-dispatch` is NOT ported. It was a Kubernetes watchdog that
 * bounded how long a native job could sit unclaimed by polling Buildkite's job
 * state, and it has no meaning here -- Woodpecker queues the workflow itself,
 * and the pipeline timeout bounds the wait.
 */

/** Selects the Mac agent; the Linux agents do not carry this label. */
const MACOS_AGENT = { platform: "darwin/arm64" } as const;

/** One Mac means one native job at a time, across every build. */
const MACOS_SERIAL = { limit: 1, group: "macos-native" } as const;

type MacosLane = {
  readonly key: string;
  readonly label: string;
  readonly timeoutMinutes: number;
  readonly commands: readonly string[];
  readonly changed: readonly string[];
};

const LANES: readonly MacosLane[] = [
  {
    key: "quotabar-macos",
    label: "QuotaBar macOS",
    timeoutMinutes: 45,
    commands: [
      "bun --no-install .buildkite/scripts/macos/macos-native-preflight.ts quotabar",
      "bun --no-install run --cwd packages/macos-ai-subscription-tracker verify:macos",
    ],
    changed: ["packages/macos-ai-subscription-tracker/**"],
  },
  {
    key: "hkctl-native",
    label: "hkctl Swift tests",
    timeoutMinutes: 20,
    commands: ["bun --no-install run --cwd packages/hkctl mac:test"],
    changed: ["packages/hkctl/**"],
  },
  {
    key: "tasknotes-native",
    label: "TaskNotes macOS",
    timeoutMinutes: 90,
    commands: [
      "bun --no-install .buildkite/scripts/macos/macos-native-preflight.ts tasknotes",
      "bun --no-install run --cwd packages/tasknotes-macos verify:macos",
    ],
    changed: [
      "packages/tasknotes-macos/**",
      "packages/tasknotes-core/**",
      "packages/tasknotes-types/**",
      "packages/tasknotes-fixtures/**",
    ],
  },
];

export function macosSteps(): CiStep[] {
  return LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    backend: "local",
    // The local backend treats `image` as the shell to run commands in.
    image: "bash",
    agentLabels: MACOS_AGENT,
    commands: [
      // Validates the pre-provisioned host against .mise.toml and
      // .xcode-version. Native jobs never install or upgrade host tools.
      ". .buildkite/scripts/macos-native-env.sh",
      ...lane.commands,
    ],
    // Native lanes gate on the Linux verify so a Swift host is never occupied
    // by a branch that does not even typecheck.
    dependsOn: ["verify"],
    timeoutMinutes: lane.timeoutMinutes,
    // Unused on the local backend -- no pod is created -- but the model
    // requires a tier, and LIGHT is the honest description of the cluster
    // resources this consumes: none.
    resources: LIGHT_TIER,
    concurrency: MACOS_SERIAL,
    changed: { include: [...GLOBAL_SELECTOR_INPUTS, ...lane.changed] },
  }));
}
