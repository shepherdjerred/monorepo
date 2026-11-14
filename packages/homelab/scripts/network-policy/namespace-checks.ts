/** Pure evaluation of one namespace's live facts into a pass/fail report. */
import { z } from "zod";
import {
  expectationOf,
  type HttpExpectation,
  type Probe,
  type UrlCheck,
} from "./namespace-urls.ts";
import { stageLabel, type Stage } from "./staging-policy.ts";

/**
 * - `pass` / `fail`: the check ran.
 * - `not-checked`: the check could not run; never counted as a pass.
 * - `info`: an observation that does not gate the result.
 */
export type CheckStatus = "pass" | "fail" | "not-checked" | "info";

export const CHECK_IDS = [
  "stage",
  "pods",
  "services",
  "urls",
  "probes",
  "denials",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckResult = {
  check: CheckId;
  status: CheckStatus;
  summary: string;
  details: string[];
};

export type NamespaceReport = {
  namespace: string;
  stage: Stage;
  ok: boolean;
  checks: CheckResult[];
};

type Item = { status: CheckStatus; detail: string };

/** The worst item decides: a failure, then anything left unchecked. */
function worstStatus(items: readonly Item[]): CheckStatus {
  if (items.some((item) => item.status === "fail")) {
    return "fail";
  }
  return items.some((item) => item.status === "not-checked")
    ? "not-checked"
    : "pass";
}

function count(items: readonly Item[], status: CheckStatus): number {
  return items.filter((item) => item.status === status).length;
}

function problems(items: readonly Item[]): string[] {
  return items
    .filter((item) => item.status !== "pass")
    .map((item) => item.detail);
}

export function evaluateStage(
  stage: Stage,
  expected: "open" | "enforced" | undefined,
): CheckResult {
  const failed =
    stage === "unrecognized" || (expected !== undefined && stage !== expected);
  const expectation =
    expected === undefined || stage === expected
      ? ""
      : `, expected ${expected}`;
  return {
    check: "stage",
    status: failed ? "fail" : "info",
    summary: `${stageLabel(stage)}${expectation}`,
    details: [],
  };
}

const ContainerStatusSchema = z.object({
  name: z.string(),
  restartCount: z.number(),
  lastState: z
    .object({
      terminated: z.object({ finishedAt: z.string().optional() }).optional(),
    })
    .optional(),
});

export const PodSchema = z.object({
  metadata: z.object({ name: z.string() }),
  status: z.object({
    phase: z.string().optional(),
    conditions: z
      .array(z.object({ type: z.string(), status: z.string() }))
      .default([]),
    containerStatuses: z.array(ContainerStatusSchema).default([]),
    initContainerStatuses: z.array(ContainerStatusSchema).default([]),
  }),
});
export type Pod = z.infer<typeof PodSchema>;

function recentRestarts(pod: Pod, since: Date): string[] {
  return [...pod.status.initContainerStatuses, ...pod.status.containerStatuses]
    .filter((container) => {
      const finishedAt = container.lastState?.terminated?.finishedAt;
      return (
        container.restartCount > 0 &&
        finishedAt !== undefined &&
        new Date(finishedAt) >= since
      );
    })
    .map((container) => container.name);
}

/** Every pod Ready, and no container restarted inside the window. */
export function evaluatePods(
  pods: readonly Pod[],
  now: Date,
  windowMinutes: number,
): CheckResult {
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  // A finished Job pod is never Ready and is not a fault.
  const running = pods.filter((pod) => pod.status.phase !== "Succeeded");
  const items = running.map((pod): Item => {
    const ready = pod.status.conditions.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    );
    if (!ready) {
      return {
        status: "fail",
        detail: `${pod.metadata.name}: not Ready (${pod.status.phase ?? "no phase"})`,
      };
    }
    const restarted = recentRestarts(pod, since);
    return restarted.length > 0
      ? {
          status: "fail",
          detail: `${pod.metadata.name}: ${restarted.join(", ")} restarted in the last ${String(windowMinutes)}m`,
        }
      : { status: "pass", detail: pod.metadata.name };
  });
  return {
    check: "pods",
    status: worstStatus(items),
    summary: `${String(count(items, "pass"))}/${String(items.length)} pods Ready with no restart in the last ${String(windowMinutes)}m`,
    details: problems(items),
  };
}

export const ServiceSchema = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    type: z.string().optional(),
    selector: z.record(z.string(), z.string()).optional(),
  }),
});
export type Service = z.infer<typeof ServiceSchema>;

export const EndpointSliceSchema = z.object({
  metadata: z.object({
    labels: z.record(z.string(), z.string()).default({}),
  }),
  endpoints: z
    .array(
      z.object({
        conditions: z
          .object({ ready: z.boolean().nullable().optional() })
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});
export type EndpointSlice = z.infer<typeof EndpointSliceSchema>;

/**
 * Every Service backed by pods has at least one ready endpoint. A Service
 * whose selector matches no pod at all (a replica Service of a one-instance
 * database, a workload scaled to zero) is noted and not counted: an unready or
 * unschedulable pod is the pods check's failure, not this one's.
 */
export function evaluateServices(
  services: readonly Service[],
  slices: readonly EndpointSlice[],
): CheckResult {
  // ExternalName and selectorless Services have no pods of this namespace.
  const selecting = services.filter(
    (service) =>
      service.spec.type !== "ExternalName" &&
      Object.keys(service.spec.selector ?? {}).length > 0,
  );
  const empty: string[] = [];
  const items = selecting.flatMap((service): Item[] => {
    const endpoints = slices
      .filter(
        (slice) =>
          slice.metadata.labels["kubernetes.io/service-name"] ===
          service.metadata.name,
      )
      .flatMap((slice) => slice.endpoints ?? []);
    if (endpoints.length === 0) {
      empty.push(`${service.metadata.name}: selects no pods (not counted)`);
      return [];
    }
    // The API documents an unset `ready` as ready.
    return endpoints.some((endpoint) => endpoint.conditions?.ready !== false)
      ? [{ status: "pass", detail: service.metadata.name }]
      : [
          {
            status: "fail",
            detail: `${service.metadata.name}: no ready endpoints`,
          },
        ];
  });
  return {
    check: "services",
    status: worstStatus(items),
    summary: `${String(count(items, "pass"))}/${String(items.length)} Services backed by pods have ready endpoints`,
    details: [...problems(items), ...empty],
  };
}

export type HttpResponse = { status: number; body: string };

function describeStatuses(statuses: HttpExpectation["statuses"]): string {
  if (statuses === "any") {
    return "any HTTP response";
  }
  return statuses === "2xx" ? "HTTP 2xx" : `HTTP ${statuses.join("|")}`;
}

function statusAccepted(
  status: number,
  statuses: HttpExpectation["statuses"],
): boolean {
  if (statuses === "any") {
    return true;
  }
  return statuses === "2xx"
    ? status >= 200 && status < 300
    : statuses.includes(status);
}

/** One URL's first answer, judged as its blackbox module judges it. */
export function evaluateUrlResponse(
  check: UrlCheck,
  response: HttpResponse | { error: string },
): Item {
  const label = `${check.kind} ${check.url}`;
  if ("error" in response) {
    return { status: "fail", detail: `${label}: ${response.error}` };
  }
  const expectation = expectationOf(check.module);
  // Redirects are not followed: the workload issuing one proves the path to
  // it, and its target is often another host or a plain-HTTP login URL the
  // TLS-only tailnet proxy does not serve.
  if (
    expectation.followRedirects &&
    response.status >= 300 &&
    response.status < 400
  ) {
    return {
      status: "pass",
      detail: `${label}: HTTP ${String(response.status)} (redirect, not followed)`,
    };
  }
  if (!statusAccepted(response.status, expectation.statuses)) {
    return {
      status: "fail",
      detail: `${label}: HTTP ${String(response.status)}, expected ${describeStatuses(expectation.statuses)} (${check.module})`,
    };
  }
  const unmatched = expectation.bodyPatterns.filter(
    (pattern) => !new RegExp(pattern, "u").test(response.body),
  );
  return unmatched.length > 0
    ? {
        status: "fail",
        detail: `${label}: body does not match ${unmatched.join(", ")} (${check.module})`,
      }
    : { status: "pass", detail: `${label}: HTTP ${String(response.status)}` };
}

export function evaluateUrls(
  answered: readonly Item[],
  unchecked: readonly string[],
): CheckResult {
  const items: Item[] = [
    ...answered,
    ...unchecked.map((detail): Item => ({ status: "not-checked", detail })),
  ];
  if (items.length === 0) {
    return {
      check: "urls",
      status: "info",
      summary: "the platform model declares no public or tailnet URL",
      details: [],
    };
  }
  return {
    check: "urls",
    status: worstStatus(items),
    summary: `${String(count(items, "pass"))}/${String(items.length)} URLs answer as expected`,
    details: items.map((item) => item.detail),
  };
}

const PrometheusVectorSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()),
        value: z.tuple([z.number(), z.string()]),
      }),
    ),
  }),
});

/** `probe_success` by job, or why Prometheus could not be read. */
export type ProbeSuccess =
  | { available: true; byJob: ReadonlyMap<string, string> }
  | { available: false; reason: string };

/** Parses `toolkit prom query probe_success -o json` output. */
export function parseProbeSuccess(stdout: string): ProbeSuccess {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { available: false, reason: "Prometheus returned no JSON" };
  }
  const parsed = PrometheusVectorSchema.safeParse(raw);
  if (!parsed.success) {
    return { available: false, reason: "unexpected Prometheus response" };
  }
  return {
    available: true,
    byJob: new Map(
      parsed.data.data.result.flatMap((series) => {
        const job = series.metric["job"];
        return job === undefined ? [] : [[job, series.value[1]] as const];
      }),
    ),
  };
}

/** The blackbox result of each of the namespace's probe targets. */
export function evaluateProbes(
  probes: readonly Probe[],
  success: ProbeSuccess,
): CheckResult {
  if (probes.length === 0) {
    return {
      check: "probes",
      status: "info",
      summary: "no blackbox probe targets this namespace",
      details: [],
    };
  }
  if (!success.available) {
    return {
      check: "probes",
      status: "not-checked",
      summary: `not checked: ${success.reason}`,
      details: [],
    };
  }
  const items = probes.map((probe): Item => {
    const job = probe.spec.jobName;
    const value = success.byJob.get(job);
    if (value === "1") {
      return { status: "pass", detail: job };
    }
    return {
      status: "fail",
      detail:
        value === undefined
          ? `${job}: no probe_success series`
          : `${job}: probe_success ${value}`,
    };
  });
  return {
    check: "probes",
    status: worstStatus(items),
    summary: `${String(count(items, "pass"))}/${String(items.length)} blackbox probes succeed`,
    details: problems(items),
  };
}

/** The enforcer's recent log, or why there is none to read. */
export type EnforcerLog =
  | { available: true; lines: readonly string[]; minutes: number }
  | { available: false; reason: string };

const DENIAL = /den(?:y|ied)|drop|reject/iu;
const SHOWN_DENIALS = 5;

/** Log lines that look like a denial and name the namespace as a whole word. */
export function denialsFor(
  namespace: string,
  lines: readonly string[],
): string[] {
  const named = new RegExp(`(?<![a-z0-9-])${namespace}(?![a-z0-9-])`, "u");
  return lines.filter((line) => DENIAL.test(line) && named.test(line));
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
  return {
    check: "denials",
    status: "info",
    summary: `${String(denials.length)} log lines look like denials in the last ${String(log.minutes)}m`,
    details: denials.slice(0, SHOWN_DENIALS),
  };
}

/** A namespace passes when no check failed. */
export function namespaceReport(
  namespace: string,
  stage: Stage,
  checks: CheckResult[],
): NamespaceReport {
  return {
    namespace,
    stage,
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}
