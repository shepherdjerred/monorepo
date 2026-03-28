import type { BuildkiteStep } from "./types.ts";
import { k8sPlugin } from "./k8s-plugin.ts";

/** Convert a name to a Buildkite-safe step key. */
export function safeKey(name: string): string {
  return name.replace(/\./g, "-").replace(/\//g, "-");
}

/** Standard retry configuration for CI steps. */
export const RETRY = {
  automatic: [
    { exit_status: -1, limit: 0 },
    { exit_status: 1, limit: 0 },
    { exit_status: 3, limit: 0 },
    { exit_status: 34, limit: 0 },
    { exit_status: 255, limit: 0 },
  ],
};

/** Dagger environment variables for CI steps. */
export const DAGGER_ENV: Record<string, string> = {
  DAGGER_NO_NAG: "1",
  DAGGER_NO_UPDATE_CHECK: "1",
  DAGGER_PROGRESS: "dots",
};

/** Create a basic Buildkite step using dagger call. */
export function daggerStep(opts: {
  label: string;
  key: string;
  daggerCmd: string;
  timeoutMinutes?: number;
  dependsOn?: string | string[];
  condition?: string;
  softFail?: boolean;
  cpu?: string;
  memory?: string;
  secrets?: string[];
}): BuildkiteStep {
  const step: BuildkiteStep = {
    label: opts.label,
    key: opts.key,
    command: opts.daggerCmd,
    timeout_in_minutes: opts.timeoutMinutes ?? 15,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        ...(opts.cpu !== undefined ? { cpu: opts.cpu } : {}),
        ...(opts.memory !== undefined ? { memory: opts.memory } : {}),
        ...(opts.secrets !== undefined ? { secrets: opts.secrets } : {}),
      }),
    ],
  };

  if (opts.dependsOn !== undefined) {
    step.depends_on = opts.dependsOn;
  }
  if (opts.condition !== undefined) {
    step.if = opts.condition;
  }
  if (opts.softFail !== undefined) {
    step.soft_fail = opts.softFail;
  }

  return step;
}
