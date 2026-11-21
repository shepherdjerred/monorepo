/** The enforcer's denials that involve one namespace: a note, never a gate. */
import type { CheckResult } from "./namespace-checks.ts";

/**
 * The enforcer's denial evidence, or why there is none to read. Each line is
 * prefixed with its agent pod in brackets. `limitReached` means a Loki query
 * returned its line limit, so the count is a lower bound.
 */
export type EnforcerLog =
  | {
      available: true;
      lines: readonly string[];
      minutes: number;
      limitReached: boolean;
    }
  | { available: false; reason: string };

// kube-network-policies v1.1.2 (klog text). A denial line carries only the
// packet id; the "Evaluating packet" line logged before it, by the same agent,
// names the pods. A deny-all policy also logs "Pod has limited all … traffic",
// but that is logged while policies are visited, before the final verdict, so
// it is not counted: another policy may still allow the packet.
// https://github.com/kubernetes-sigs/kube-network-policies/blob/v1.1.2/pkg/networkpolicy/engine.go
const DENIED = /"Packet denied by (?:egress|ingress) policy".*?\bid=(\d+)/u;
const EVALUATING = /"Evaluating packet".*?\bid=(\d+)/u;
const SHOWN_DENIALS = 5;

/** The packet id of a denial line. */
export function deniedPacketId(line: string): string | undefined {
  return DENIED.exec(line)?.[1];
}

/** The `[pod]` prefix names the agent; packet ids are per agent. */
function agentOf(line: string): string {
  return /^\[[^\]]+\]/u.exec(line)?.[0] ?? "";
}

function field(line: string, key: string): string | undefined {
  return new RegExp(String.raw`\b${key}="([^"]+)"`, "u").exec(line)?.[1];
}

function inNamespace(
  reference: string | undefined,
  namespace: string,
): boolean {
  return reference?.startsWith(`${namespace}/`) ?? false;
}

/**
 * Denials whose source or destination pod is in the namespace, each paired
 * with the packet description that names the pods.
 */
export function denialsFor(
  namespace: string,
  lines: readonly string[],
): string[] {
  const evaluated = new Map<string, string>();
  const denials: string[] = [];
  for (const line of lines) {
    const evaluating = EVALUATING.exec(line);
    if (evaluating !== null) {
      evaluated.set(`${agentOf(line)}#${evaluating[1] ?? ""}`, line);
      continue;
    }
    const denied = deniedPacketId(line);
    if (denied !== undefined) {
      const packet = evaluated.get(`${agentOf(line)}#${denied}`);
      if (
        packet !== undefined &&
        (inNamespace(field(packet, "srcPod"), namespace) ||
          inNamespace(field(packet, "dstPod"), namespace))
      ) {
        denials.push(`${line} <- ${packet}`);
      }
    }
  }
  return denials;
}

/** A note, never a gate: the enforcer has no deny-only log to count from. */
export function evaluateDenials(
  namespace: string,
  log: EnforcerLog,
): CheckResult {
  if (!log.available) {
    return {
      check: "denials",
      status: "info",
      summary: `not available: ${log.reason}`,
      details: [],
    };
  }
  const denials = denialsFor(namespace, log.lines);
  const counted = `${String(denials.length)} denials involving this namespace in the last ${String(log.minutes)}m`;
  return {
    check: "denials",
    status: "info",
    summary: log.limitReached
      ? `at least ${counted} (a Loki query reached its line limit)`
      : counted,
    details: denials.slice(0, SHOWN_DENIALS),
  };
}
