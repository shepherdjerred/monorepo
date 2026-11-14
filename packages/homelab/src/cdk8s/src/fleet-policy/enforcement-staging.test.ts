import { App, Chart, Testing } from "cdk8s";
import { beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { applyEnforcementStaging } from "@shepherdjerred/homelab/cdk8s/src/enforcement-staging.ts";
import {
  ENFORCEMENT_STAGING_NEVER_LABEL,
  enforcementStagingPolicy,
  enforcementStagingPolicyName,
  type EnforcementStage,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { COMPANION_CHARTS } from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";
import {
  SynthesizedObjectSchema,
  synthesizedCharts,
  type SynthesizedObject,
} from "@shepherdjerred/homelab/cdk8s/src/testing/synthesized-charts.ts";
import {
  ENFORCED_WITHOUT_STAGING,
  ENFORCEMENT_STAGES,
  enforcedWithoutStaging,
  enforcementStageOf,
  STAGED_WITHOUT_RENDERED_POLICY,
} from "./enforcement-stages.ts";
import { fleetOf } from "./fleet.ts";
import { unreciprocatedRules } from "./policy-reciprocity.ts";
import { probePortsNotAdmitted } from "./probe-admission.ts";
import {
  upstreamNamespacesWithoutPolicy,
  workloadsWithoutPolicy,
} from "./rules.ts";

/**
 * Enforcement staging: every namespace the charts render a NetworkPolicy into
 * carries exactly one `enforcement-staging-<namespace>` policy at its recorded stage, and
 * no fleet rule mistakes that allow-all policy for real coverage.
 */

const ALLOW_ALL = {
  policyTypes: ["Ingress", "Egress"],
  ingress: [{}],
  egress: [{}],
};

/** What a staging policy renders as at each stage. */
const EXPECTED_SPEC: Readonly<Record<EnforcementStage, unknown>> = {
  open: { podSelector: {}, ...ALLOW_ALL },
  enforced: {
    podSelector: { matchLabels: ENFORCEMENT_STAGING_NEVER_LABEL },
    ...ALLOW_ALL,
  },
};

function isPolicy(object: SynthesizedObject): boolean {
  return (
    object.kind === "NetworkPolicy" &&
    object.apiVersion === "networking.k8s.io/v1"
  );
}

function isStaging(object: SynthesizedObject): boolean {
  return (
    isPolicy(object) &&
    object.metadata.name ===
      enforcementStagingPolicyName(object.metadata.namespace ?? "")
  );
}

function namespacesOf(objects: readonly SynthesizedObject[]): string[] {
  return [
    ...new Set(objects.map((object) => object.metadata.namespace ?? "")),
  ].sort();
}

function rendered(chart: Chart): SynthesizedObject[] {
  return z.array(SynthesizedObjectSchema).parse(Testing.synth(chart));
}

describe("the fleet's enforcement staging", () => {
  /**
   * Every chart's objects but the companions', which re-render root objects:
   * `companions.test.ts` holds them byte-identical to the root's.
   */
  let objects: SynthesizedObject[];
  beforeAll(async () => {
    const charts = await synthesizedCharts();
    objects = [...charts]
      .filter(([id]) => !COMPANION_CHARTS.has(id))
      .flatMap(([, chartObjects]) => chartObjects);
  });

  const realPolicies = () =>
    objects.filter((object) => isPolicy(object) && !isStaging(object));
  const stagingPolicies = () => objects.filter((object) => isStaging(object));
  /** Every namespace that must be staged: rendered policies, or declared. */
  const stagedNamespaces = () =>
    [
      ...namespacesOf(realPolicies()),
      ...Object.keys(STAGED_WITHOUT_RENDERED_POLICY),
    ].sort();

  test("every namespace with a NetworkPolicy has a stage entry", () => {
    expect(
      namespacesOf(realPolicies()).filter(
        (namespace) => ENFORCEMENT_STAGES[namespace] === undefined,
      ),
    ).toEqual([]);
  });

  test("every staged namespace has exactly one staging policy across all charts", () => {
    // Not deduplicated: two charts rendering the same staging policy would be
    // two Applications contending for one object.
    expect(
      stagingPolicies()
        .map((object) => object.metadata.namespace ?? "")
        .sort(),
    ).toEqual(stagedNamespaces());
  });

  test("has no stale stage entry", () => {
    expect(Object.keys(ENFORCEMENT_STAGES).sort()).toEqual(stagedNamespaces());
  });

  test("a namespace staged without a rendered policy has none rendered", () => {
    const withPolicies = new Set(namespacesOf(realPolicies()));
    expect(
      Object.keys(STAGED_WITHOUT_RENDERED_POLICY).filter((namespace) =>
        withPolicies.has(namespace),
      ),
    ).toEqual([]);
  });

  test("no staged namespace is also listed as enforced without staging", () => {
    expect(
      Object.keys(ENFORCEMENT_STAGES).filter((namespace) =>
        enforcedWithoutStaging(namespace),
      ),
    ).toEqual([]);
  });

  test("each staging policy renders its namespace's recorded stage", () => {
    expect(stagingPolicies().length).toBeGreaterThan(30);
    for (const policy of stagingPolicies()) {
      const namespace = policy.metadata.namespace ?? "";
      expect(policy.spec, namespace).toEqual(
        EXPECTED_SPEC[enforcementStageOf(namespace)],
      );
    }
  });
});

describe("enforcedWithoutStaging", () => {
  test("matches a listed name exactly and a listed prefix by prefix", () => {
    expect(ENFORCED_WITHOUT_STAGING.length).toBeGreaterThan(0);
    expect(enforcedWithoutStaging("delivery-catalog-recovery")).toBe(true);
    expect(enforcedWithoutStaging("delivery-catalog-recovery-2")).toBe(false);
    expect(enforcedWithoutStaging("pg18-rehearsal-temporal")).toBe(true);
    expect(enforcedWithoutStaging("ops-restore-temporal-20261010")).toBe(true);
    expect(enforcedWithoutStaging("temporal")).toBe(false);
  });
});

describe("enforcementStagingPolicy", () => {
  test.each(["open", "enforced"] as const)(
    "a namespace that is %s renders one allow-all policy with that stage's selector",
    (stage) => {
      const chart = Testing.chart();
      enforcementStagingPolicy(chart, "example", stage);
      const [policy, ...others] = rendered(chart);
      expect(others).toEqual([]);
      expect(policy?.metadata).toMatchObject({
        name: "enforcement-staging-example",
        namespace: "example",
        annotations: { "homelab.sjer.red/enforcement-stage": stage },
      });
      expect(policy?.spec).toEqual(EXPECTED_SPEC[stage]);
    },
  );

  test("open selects every pod and enforced selects only the label no pod carries", () => {
    expect(EXPECTED_SPEC.open).toMatchObject({ podSelector: {} });
    expect(EXPECTED_SPEC.enforced).toMatchObject({
      podSelector: {
        matchLabels: { "homelab.sjer.red/enforcement-staging": "never" },
      },
    });
  });
});

function policyIn(chart: Chart, namespace: string, name = "real"): void {
  new KubeNetworkPolicy(chart, `${namespace}-${name}`, {
    metadata: { name, namespace },
    spec: { podSelector: {}, policyTypes: ["Ingress"] },
  });
}

describe("applyEnforcementStaging", () => {
  test("stages each namespace a chart renders a policy into, once", () => {
    const app = new App();
    const chart = new Chart(app, "woodpecker");
    policyIn(chart, "woodpecker", "a");
    policyIn(chart, "woodpecker", "b");
    policyIn(chart, "woodpecker-ci");
    new Chart(app, "no-policies");
    applyEnforcementStaging(app, {});
    expect(
      rendered(chart)
        .filter((object) => isStaging(object))
        .map((object) => object.metadata.namespace),
    ).toEqual(["woodpecker", "woodpecker-ci"]);
  });

  test("a namespace without a stage entry fails synthesis", () => {
    const app = new App();
    policyIn(new Chart(app, "new-service"), "new-service");
    expect(() => {
      applyEnforcementStaging(app, {});
    }).toThrow(
      /new-service renders a NetworkPolicy but has no enforcement stage/u,
    );
  });

  test("charts sharing a namespace render one staging policy, in the declared owner", () => {
    const app = new App();
    const data = new Chart(app, "temporal-data");
    const owner = new Chart(app, "temporal");
    policyIn(data, "temporal", "database");
    policyIn(owner, "temporal", "server");
    applyEnforcementStaging(app, {});
    expect(rendered(data).filter((object) => isStaging(object))).toEqual([]);
    expect(rendered(owner).filter((object) => isStaging(object))).toHaveLength(
      1,
    );
  });

  test("charts sharing a namespace without a declared owner fail synthesis", () => {
    const app = new App();
    policyIn(new Chart(app, "one"), "media", "a");
    policyIn(new Chart(app, "two"), "media", "b");
    expect(() => {
      applyEnforcementStaging(app, {});
    }).toThrow(/name one of them in SHARED_NAMESPACE_OWNERS/u);
  });

  test("a hand-written policy may not take the staging policy's name", () => {
    const app = new App();
    policyIn(
      new Chart(app, "media"),
      "media",
      enforcementStagingPolicyName("media"),
    );
    expect(() => {
      applyEnforcementStaging(app, {});
    }).toThrow(/only applyEnforcementStaging renders/u);
  });

  test("a namespace staged without a rendered policy gets one in each named chart", () => {
    const app = new App();
    const root = new Chart(app, "apps");
    const companion = new Chart(app, "argocd-companion");
    applyEnforcementStaging(app, {
      argocd: { charts: ["apps", "argocd-companion", "prometheus-companion"] },
    });
    for (const chart of [root, companion])
      expect(
        rendered(chart).map((object) => [
          object.metadata.namespace,
          object.metadata.name,
        ]),
      ).toEqual([["argocd", "enforcement-staging-argocd"]]);
  });

  test("a declared namespace that a chart now renders a policy into fails synthesis", () => {
    const app = new App();
    policyIn(new Chart(app, "media"), "media");
    expect(() => {
      applyEnforcementStaging(app, { media: { charts: ["media"] } });
    }).toThrow(/a chart now renders a policy into: delete the entry/u);
  });

  test("a declared chart that is not rendered fails synthesis", () => {
    const app = new App();
    new Chart(app, "apps");
    expect(() => {
      applyEnforcementStaging(app, { argocd: { charts: ["missing"] } });
    }).toThrow(/names chart missing for argocd, which is not rendered/u);
  });
});

/**
 * A namespace whose only policy is an open staging policy: one workload, a
 * probed Service in front of it, and an Application deploying an upstream
 * chart into a second such namespace.
 */
function fleetWithOnlyStagingPolicies(realPolicy: boolean) {
  const chart = Testing.chart();
  enforcementStagingPolicy(chart, "app", "open");
  enforcementStagingPolicy(chart, "upstream", "open");
  if (realPolicy) policyIn(chart, "app");
  const labels = { app: "web" };
  const objects: SynthesizedObject[] = [
    ...rendered(chart),
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "app" },
      spec: {
        template: {
          metadata: { labels },
          spec: { containers: [{ name: "web" }] },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "web", namespace: "app" },
      spec: { selector: labels, ports: [{ port: 80 }] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "web", namespace: "app" },
      spec: {
        ingressClassName: "tailscale",
        defaultBackend: { service: { name: "web", port: { number: 80 } } },
      },
    },
    {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "upstream", namespace: "argocd" },
      spec: { destination: { namespace: "upstream" } },
    },
  ];
  return fleetOf(objects, [
    {
      namespace: "app",
      serviceName: "web",
      port: 80,
      module: "tcp_connect",
      path: "/",
    },
  ]);
}

describe("fleet rules ignore the staging policy", () => {
  const fleet = fleetWithOnlyStagingPolicies(false);

  test("the fleet keeps staging policies apart from the policies its rules read", () => {
    expect(fleet.networkPolicies).toEqual([]);
    expect(
      fleet.enforcementStagingPolicies.map((policy) => policy.namespace),
    ).toEqual(["app", "upstream"]);
  });

  test.each(["Ingress", "Egress"] as const)(
    "an open namespace does not give its workload an %s policy",
    (type) => {
      expect(workloadsWithoutPolicy(fleet, type)).toEqual(["app/web"]);
    },
  );

  test.each(["Ingress", "Egress"] as const)(
    "an open namespace does not give an upstream-chart namespace an %s policy",
    (type) => {
      expect(upstreamNamespacesWithoutPolicy(fleet, type)).toEqual([
        "upstream",
      ]);
    },
  );

  test("an open namespace does not admit a probe its real policy closes", () => {
    // The real policy selects the pods and admits nothing; only the staging
    // policy would let blackbox-exporter and the Tailscale proxy through.
    expect(probePortsNotAdmitted(fleetWithOnlyStagingPolicies(true))).toEqual([
      "app/web:80 from prometheus",
      "app/web:80 from tailscale",
    ]);
  });

  test("an open namespace does not answer another namespace's rule", () => {
    const chart = Testing.chart();
    enforcementStagingPolicy(chart, "server", "open");
    new KubeNetworkPolicy(chart, "server-ingress", {
      metadata: { name: "server", namespace: "server" },
      spec: { podSelector: {}, policyTypes: ["Ingress"] },
    });
    new KubeNetworkPolicy(chart, "client-egress", {
      metadata: { name: "client", namespace: "client" },
      spec: {
        podSelector: {},
        policyTypes: ["Egress"],
        egress: [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": "server" },
                },
              },
            ],
          },
        ],
      },
    });
    expect(unreciprocatedRules(fleetOf(rendered(chart), []), "Egress")).toEqual(
      ["client/client -> server:*"],
    );
  });
});
