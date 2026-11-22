/** Test fixtures: live-shaped objects and a recording fake command runner. */
import { BREAK_GLASS_LABEL, breakGlassPolicyName } from "./break-glass.ts";
import type { CommandResult, CommandRunner } from "./command.ts";
import type { Probe } from "./namespace-urls.ts";
import type { NetworkPolicy } from "./policies.ts";

const ALLOW_ALL = {
  policyTypes: ["Ingress", "Egress"],
  ingress: [{}],
  egress: [{}],
};

/** An allow-all policy that is not a break-glass policy. */
export function allowAllPolicy(namespace: string, name: string): NetworkPolicy {
  return {
    metadata: { name, namespace },
    spec: { podSelector: {}, ...ALLOW_ALL },
  };
}

/** A break-glass policy; overrides make the half-matching variants. */
export function breakGlassPolicy(
  namespace: string,
  overrides: { name?: string; labelled?: boolean } = {},
): NetworkPolicy {
  return {
    metadata: {
      name: overrides.name ?? breakGlassPolicyName(namespace),
      namespace,
      ...(overrides.labelled === false
        ? {}
        : { labels: { [BREAK_GLASS_LABEL]: "true" } }),
    },
    spec: { podSelector: {}, ...ALLOW_ALL },
  };
}

export function otherPolicy(namespace: string, name: string): NetworkPolicy {
  return {
    metadata: { name, namespace },
    spec: { podSelector: { matchLabels: { app: name } }, ...ALLOW_ALL },
  };
}

export function probe(
  jobName: string,
  module: Probe["spec"]["module"],
  target: string,
  labels: Record<string, string>,
): Probe {
  return {
    metadata: { name: jobName, namespace: "prometheus" },
    spec: {
      jobName,
      module,
      targets: { staticConfig: { static: [target], labels } },
    },
  };
}

/**
 * A Failed pod as `kubectl get pods -o json` returns it. A `null` finish is
 * the shape the kubelet leaves when it refuses a pod at admission after a node
 * reboot (`UnexpectedAdmissionError`): its lost container has no finish time.
 */
export function failedPod(
  name: string,
  times: { created: string; transitioned?: string; finished?: string | null },
) {
  return {
    metadata: { name, creationTimestamp: times.created },
    status: {
      phase: "Failed",
      reason: "UnexpectedAdmissionError",
      conditions:
        times.transitioned === undefined
          ? []
          : [
              {
                type: "Ready",
                status: "False",
                lastTransitionTime: times.transitioned,
              },
            ],
      containerStatuses:
        times.finished === undefined
          ? []
          : [
              {
                name: "app",
                restartCount: 0,
                state: {
                  terminated: { exitCode: 1, finishedAt: times.finished },
                },
              },
            ],
    },
  };
}

export type Call = { command: readonly string[]; stdin: string | undefined };

/**
 * A runner that records every call and answers the first matching reply, by
 * a substring of the joined command. An unmatched command exits 1.
 */
export function fakeRunner(
  replies: readonly (readonly [
    string,
    Partial<CommandResult> | (() => Partial<CommandResult>),
  ])[],
): { run: CommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: CommandRunner = (command, stdin) => {
    calls.push({ command, stdin });
    const joined = command.join(" ");
    const reply = replies.find(([match]) => joined.includes(match))?.[1];
    const result = typeof reply === "function" ? reply() : reply;
    return Promise.resolve({
      exitCode: result === undefined ? 1 : 0,
      stdout: "",
      stderr: result === undefined ? `no fake for: ${joined}` : "",
      ...result,
    });
  };
  return { run, calls };
}

export function items(...entries: unknown[]): { stdout: string } {
  return { stdout: JSON.stringify({ items: entries }) };
}
