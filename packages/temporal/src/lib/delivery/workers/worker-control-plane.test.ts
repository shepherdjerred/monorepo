import { expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  controlPlaneTemplates,
  requireUnchangedControlPlane,
  renderControlPlaneTemplates,
  requireIsolatedControlPlane,
} from "./worker-control-plane.ts";

function host() {
  return {
    kind: "Deployment",
    metadata: { name: "executor", namespace: "temporal" },
    spec: {
      template: {
        metadata: {
          labels: { component: "delivery-worker" },
          annotations: { "source-owned": "exact" },
        },
        spec: {
          serviceAccountName: "restricted-worker",
          containers: [
            {
              name: "worker",
              image: `docker.io/shepherdjerred/temporal-worker:2.0.0-1@sha256:${"a".repeat(64)}`,
              command: ["bun", "worker.ts"],
              env: [{ name: "TEMPORAL_WORKER_ROLE", value: "delivery" }],
              readinessProbe: { httpGet: { path: "/ready", port: 9465 } },
              resources: { requests: { cpu: "100m" } },
              securityContext: { allowPrivilegeEscalation: false },
              volumeMounts: [
                { name: "private", mountPath: "/private", readOnly: true },
              ],
            },
          ],
          volumes: [
            { name: "private", secret: { secretName: "exact-secret" } },
          ],
        },
      },
    },
  };
}

test("normalizes only actual Kubernetes defaults while retaining all control-plane restart inputs", () => {
  const selected = host();
  const live = structuredClone(selected);
  const template = live.spec.template;
  Object.assign(template.metadata, { creationTimestamp: null });
  Object.assign(template.spec, {
    serviceAccount: "restricted-worker",
    dnsPolicy: "ClusterFirst",
    restartPolicy: "Always",
    schedulerName: "default-scheduler",
    terminationGracePeriodSeconds: 30,
    enableServiceLinks: true,
    securityContext: {},
  });
  const containers = template.spec.containers;
  Object.assign(containers[0]!, {
    imagePullPolicy: "IfNotPresent",
    terminationMessagePath: "/dev/termination-log",
    terminationMessagePolicy: "File",
  });
  const probe = containers[0]!.readinessProbe;
  Object.assign(probe, {
    timeoutSeconds: 1,
    periodSeconds: 10,
    failureThreshold: 3,
    successThreshold: 1,
  });
  Object.assign(probe.httpGet, { scheme: "HTTP" });
  Object.assign(template.spec.volumes[0]!.secret, { defaultMode: 420 });
  expect(() =>
    requireUnchangedControlPlane(controlPlaneTemplates([selected]), [live]),
  ).not.toThrow();
});

test("ordinary worker releases reject historical unsplit charts and accept only independently owned application templates", () => {
  const application = host();
  application.metadata.name = "application";
  application.spec.template.metadata.labels.component =
    "central-workflows-retained-original";
  expect(() =>
    requireIsolatedControlPlane(controlPlaneTemplates([application])),
  ).not.toThrow();
  expect(() =>
    requireIsolatedControlPlane(controlPlaneTemplates([application, host()])),
  ).toThrow("Historical central chart");
});

test("Kubernetes quantity and hostNetwork defaults preserve the exact control-plane template fence", () => {
  const selected = host();
  Object.assign(selected.spec.template.spec, { hostNetwork: false });
  const resources = {
    requests: { cpu: "1000m", memory: "1024Mi" },
    limits: { cpu: "1000m", memory: "1024Mi", "example.com/device": "1" },
  };
  Object.assign(selected.spec.template.spec.containers[0]!, { resources });
  Object.assign(selected.spec.template.spec, {
    initContainers: [{ name: "init", image: "exact", resources }],
  });
  const expected = controlPlaneTemplates([selected]);
  const live = structuredClone(selected);
  const pod = live.spec.template.spec;
  Reflect.deleteProperty(pod, "hostNetwork");
  const init = {
    name: "init",
    image: "exact",
    resources: structuredClone(resources),
  };
  Object.assign(pod, { initContainers: [init] });
  for (const container of [...pod.containers, init])
    Object.assign(container.resources, {
      requests: { cpu: "1", memory: "1Gi" },
      limits: { cpu: "1", memory: "1Gi", "example.com/device": "1" },
    });
  expect(() => requireUnchangedControlPlane(expected, [live])).not.toThrow();
  for (const mutate of [
    (value: typeof live) => {
      value.spec.template.spec.containers[0]!.resources.requests.cpu = "2";
    },
    (value: typeof live) => {
      Object.assign(value.spec.template.spec.containers[0]!.resources, {
        limits: { cpu: "1", memory: "2Gi", "example.com/device": "1" },
      });
    },
    (value: typeof live) => {
      Object.assign(value.spec.template.spec, { hostNetwork: true });
    },
    (value: typeof live) => {
      Object.assign(value.spec.template.spec.containers[0]!.resources, {
        limits: { cpu: "1", memory: "1Gi", "example.com/device": "1000m" },
      });
    },
    (value: typeof live) => {
      Object.assign(value.spec.template.spec, { unknownField: false });
    },
  ]) {
    const changed = structuredClone(live);
    mutate(changed);
    expect(() => requireUnchangedControlPlane(expected, [changed])).toThrow(
      "Pod template",
    );
  }
});

test.each(["", "not-a-quantity", "Infinity", "NaN", "9007199254740993", "-1"])(
  "refuses corrupt or unsafe resource quantity %j",
  (quantity) => {
    const selected = host();
    selected.spec.template.spec.containers[0]!.resources.requests.cpu =
      quantity;
    expect(() => controlPlaneTemplates([selected])).toThrow();
  },
);

test("ordinary releases cannot change command, environment, annotations, resources, probes, account, mounts or security", () => {
  const expected = controlPlaneTemplates([host()]);
  const mutations = [
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.command = ["different"];
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.env[0]!.value = "all";
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.metadata.annotations["source-owned"] = "changed";
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.resources.requests.cpu = "2";
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.readinessProbe.httpGet.path =
        "/different";
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.serviceAccountName = "privileged";
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.volumeMounts[0]!.readOnly = false;
    },
    (value: ReturnType<typeof host>) => {
      value.spec.template.spec.containers[0]!.securityContext.allowPrivilegeEscalation = true;
    },
  ];
  for (const mutate of mutations) {
    const changed = host();
    mutate(changed);
    expect(() => requireUnchangedControlPlane(expected, [changed])).toThrow(
      "Pod template",
    );
  }
  expect(() => requireUnchangedControlPlane(expected, [])).toThrow(
    "Pod template",
  );
  const added = host();
  added.metadata.name = "second-executor";
  expect(() => requireUnchangedControlPlane(expected, [host(), added])).toThrow(
    "Pod template",
  );
});

async function run(command: readonly string[]) {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, stderr).toBe(0);
  return { stdout, stderr };
}
test("renders the content-verified qualified archive with the frozen original CP parameter before any source write", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-cp-render-test-"),
  );
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const chart = path.join(directory, "temporal");
    await mkdir(path.join(chart, "templates"), { recursive: true });
    await Bun.write(
      path.join(chart, "Chart.yaml"),
      "apiVersion: v2\nname: temporal\nversion: 2.0.0-1\n",
    );
    const selected = host();
    const reference = selected.spec.template.spec.containers[0]!.image;
    await Bun.write(
      path.join(chart, "templates/worker.yaml"),
      JSON.stringify(selected).replace(
        reference,
        '{{ get .Values.delivery.images "delivery-control-plane" }}',
      ),
    );
    await run(["helm", "package", chart, "--destination", directory]);
    const bytes = new Uint8Array(
      await Bun.file(
        path.join(directory, "temporal-2.0.0-1.tgz"),
      ).arrayBuffer(),
    );
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(bytes),
    });
    const proof = {
      selection: {
        application: "temporal",
        environmentId: "temporal/prod",
        repository: server.url.origin,
        chart: "temporal",
        revision: "2.0.0-1",
        namespace: "temporal",
        parameters: {
          "delivery.images.delivery-control-plane": reference,
          "delivery.images.temporal-worker": `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`,
        },
      },
      chart: {
        id: "original-chart/1",
        component: "chart:temporal",
        kind: "chart",
        uri: new URL("/charts/temporal-2.0.0-1.tgz", server.url).href,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        version: "2.0.0-1",
        serviceId: "temporal",
        buildId: "original-build/1",
        sourceRevision: "a".repeat(40),
        createdAt: new Date().toISOString(),
      },
    };
    const rendered = await renderControlPlaneTemplates(proof, run);
    expect(rendered).toEqual(controlPlaneTemplates([selected]));
    await expect(
      renderControlPlaneTemplates(
        {
          ...proof,
          chart: { ...proof.chart, digest: `sha256:${"0".repeat(64)}` },
        },
        run,
      ),
    ).rejects.toThrow("chart bytes");
  } finally {
    await server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
