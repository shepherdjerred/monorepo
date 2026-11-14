/** Test fixtures: live-shaped objects and a recording fake command runner. */
import type { CommandResult, CommandRunner } from "./command.ts";
import type { Probe } from "./namespace-urls.ts";
import {
  NEVER_LABEL,
  NEVER_VALUE,
  stagingPolicyName,
  type NetworkPolicy,
} from "./staging-policy.ts";

const ALLOW_ALL = {
  policyTypes: ["Ingress", "Egress"],
  ingress: [{}],
  egress: [{}],
};

export function stagingPolicy(
  namespace: string,
  stage: "open" | "enforced",
  application?: string,
): NetworkPolicy {
  return {
    metadata: {
      name: stagingPolicyName(namespace),
      namespace,
      ...(application === undefined
        ? {}
        : {
            annotations: {
              "argocd.argoproj.io/tracking-id": `${application}:networking.k8s.io/NetworkPolicy:${namespace}/${stagingPolicyName(namespace)}`,
            },
          }),
    },
    spec: {
      podSelector:
        stage === "open" ? {} : { matchLabels: { [NEVER_LABEL]: NEVER_VALUE } },
      ...ALLOW_ALL,
    },
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
