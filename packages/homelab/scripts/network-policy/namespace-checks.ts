/** Pure evaluation of one namespace's live facts into a pass/fail report. */
import { z } from "zod";
import {
  expectationOf,
  type HttpExpectation,
  type Probe,
  type UrlCheck,
} from "./namespace-urls.ts";
import type { BreakGlassState } from "./break-glass.ts";

/**
 * - `pass` / `fail`: the check ran.
 * - `not-checked`: the check could not run; never counted as a pass.
 * - `info`: an observation that does not gate the result.
 */
export type CheckStatus = "pass" | "fail" | "not-checked" | "info";

export const CHECK_IDS = [
  "break-glass",
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
  /** A break-glass policy opens the namespace while it exists. */
  breakGlass: BreakGlassState;
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

const BREAK_GLASS_SUMMARIES: Record<BreakGlassState, string> = {
  none: "no break-glass policy",
  open: "open (break-glass)",
  unrecognized: "unrecognized break-glass policy",
};

/**
 * Fails while any break-glass candidate exists, unless `allowBreakGlass`, so
 * a forgotten break-glass cannot hide behind a passing gate.
 */
export function evaluateBreakGlass(
  namespace: string,
  breakGlass: BreakGlassState,
  allowBreakGlass: boolean,
): CheckResult {
  const forgotten = breakGlass !== "none" && !allowBreakGlass;
  return {
    check: "break-glass",
    status: forgotten ? "fail" : breakGlass === "none" ? "pass" : "info",
    summary: BREAK_GLASS_SUMMARIES[breakGlass],
    details: forgotten
      ? [
          `a break-glass policy is live: fix the policy in source, then run netpol:open ${namespace} --close --apply (or pass --allow-break-glass)`,
        ]
      : [],
  };
}

// A container the kubelet lost track of (`ContainerStatusUnknown`, as after a
// node reboot) is reported terminated with `finishedAt: null`.
const ContainerStateSchema = z
  .object({
    terminated: z
      .object({ finishedAt: z.string().nullable().optional() })
      .optional(),
  })
  .optional();

const ContainerStatusSchema = z.object({
  name: z.string(),
  restartCount: z.number(),
  state: ContainerStateSchema,
  lastState: ContainerStateSchema,
});

export const PodSchema = z.object({
  metadata: z.object({
    name: z.string(),
    creationTimestamp: z.string().optional(),
  }),
  status: z.object({
    phase: z.string().optional(),
    conditions: z
      .array(
        z.object({
          type: z.string(),
          status: z.string(),
          lastTransitionTime: z.string().nullable().optional(),
        }),
      )
      .default([]),
    containerStatuses: z.array(ContainerStatusSchema).default([]),
    initContainerStatuses: z.array(ContainerStatusSchema).default([]),
  }),
});
export type Pod = z.infer<typeof PodSchema>;

function containersOf(pod: Pod) {
  return [...pod.status.initContainerStatuses, ...pod.status.containerStatuses];
}

/**
 * When a Failed pod terminated: the latest container finish or condition
 * transition (a pod the kubelet refused at admission has no container
 * statuses), else its creation. Undefined when the pod carries no time.
 */
export function failedAt(pod: Pod): Date | undefined {
  const times = [
    ...containersOf(pod).map(
      (container) => container.state?.terminated?.finishedAt,
    ),
    ...pod.status.conditions.map((condition) => condition.lastTransitionTime),
  ]
    .filter((time) => typeof time === "string")
    .map((time) => new Date(time).getTime());
  if (times.length > 0) {
    return new Date(Math.max(...times));
  }
  const created = pod.metadata.creationTimestamp;
  return created === undefined ? undefined : new Date(created);
}

/** Every pod but finished Job pods: what the namespace runs, or tried to. */
export function activePods(pods: readonly Pod[]): Pod[] {
  // A finished Job pod is never Ready and is not a fault.
  return pods.filter((pod) => pod.status.phase !== "Succeeded");
}

function recentRestarts(pod: Pod, since: Date): string[] {
  return containersOf(pod)
    .filter((container) => {
      const finishedAt = container.lastState?.terminated?.finishedAt;
      return (
        container.restartCount > 0 &&
        typeof finishedAt === "string" &&
        new Date(finishedAt) >= since
      );
    })
    .map((container) => container.name);
}

/**
 * Every pod Ready, and no container restarted inside the window. A Failed pod
 * that terminated before the window (one a node reboot left behind, already
 * replaced by its controller) is noted and not counted; one that failed inside
 * the window, a Job's included, fails the check.
 */
export function evaluatePods(
  pods: readonly Pod[],
  now: Date,
  windowMinutes: number,
): CheckResult {
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  const window = `the last ${String(windowMinutes)}m`;
  const earlier: string[] = [];
  const items = activePods(pods).flatMap((pod): Item[] => {
    const name = pod.metadata.name;
    if (pod.status.phase === "Failed") {
      const at = failedAt(pod);
      if (at !== undefined && at < since) {
        earlier.push(
          `${name}: Failed at ${at.toISOString()}, before ${window} (not counted)`,
        );
        return [];
      }
    }
    const ready = pod.status.conditions.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    );
    if (!ready) {
      return [
        {
          status: "fail",
          detail: `${name}: not Ready (${pod.status.phase ?? "no phase"})`,
        },
      ];
    }
    const restarted = recentRestarts(pod, since);
    return [
      restarted.length > 0
        ? {
            status: "fail",
            detail: `${name}: ${restarted.join(", ")} restarted in ${window}`,
          }
        : { status: "pass", detail: name },
    ];
  });
  return {
    check: "pods",
    status: worstStatus(items),
    summary: `${String(count(items, "pass"))}/${String(items.length)} pods Ready with no restart in ${window}`,
    details: [...problems(items), ...earlier],
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

/**
 * A namespace scaled to zero serves its URLs from no pod, so a proxy error
 * there says nothing about its policies: its URLs are not requested.
 */
export function evaluateUrlsWithoutPods(declared: number): CheckResult {
  if (declared === 0) {
    return evaluateUrls([], []);
  }
  return {
    check: "urls",
    status: "info",
    summary: `namespace runs no pods; ${String(declared)} URL${declared === 1 ? "" : "s"} not checked`,
    details: [],
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

/** A namespace passes when no check failed. */
export function namespaceReport(
  namespace: string,
  breakGlass: BreakGlassState,
  checks: CheckResult[],
): NamespaceReport {
  return {
    namespace,
    breakGlass,
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}
