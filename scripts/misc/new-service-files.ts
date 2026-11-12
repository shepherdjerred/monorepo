import type { ServiceOptions } from "./new-service-options.ts";

/**
 * The files `new-service.ts` creates for a hosted service: its package's
 * entrypoint and Dockerfile, its cdk8s chart, its Argo Application and its
 * Helm chart manifest. Paths are relative to the repository root.
 */

const HOMELAB = "@shepherdjerred/homelab/cdk8s/src";
const CDK8S_ROOT = "packages/homelab/src/cdk8s";

/** `storm-brain` as `StormBrain`. */
export function pascalCase(name: string): string {
  return name
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join("");
}

/** The activation gate's constant: `storm-brain` as `STORM_BRAIN_ACTIVE`. */
export function activationConstant(name: string): string {
  return `${name.replaceAll("-", "_").toUpperCase()}_ACTIVE`;
}

/**
 * The port the in-image smoke run binds, clear of the production port as the
 * other services' smoke commands are.
 */
export function smokePort(port: number): number {
  return port + 10_000;
}

function serverSource({ name }: ServiceOptions): string {
  return `/** Answers the kubelet probes and the image smoke run. */
export function handle(request: Request): Response {
  return new URL(request.url).pathname === "/healthz"
    ? new Response("ok")
    : new Response("not found", { status: 404 });
}

export function startServer(port: number, hostname: string) {
  const server = Bun.serve({ port, hostname, fetch: handle });
  console.warn(\`${name} listening on :\${String(server.port)}\`);
  return server;
}
`;
}

function entrypointSource({ kind, port }: ServiceOptions): string {
  const next =
    kind === "worker"
      ? "\n// Start the worker's own loop here; the server above only reports health.\n"
      : "";
  return `import { startServer } from "./server.ts";

startServer(
  Number(Bun.env["PORT"] ?? "${String(port)}"),
  Bun.env["HOST"] ?? "0.0.0.0",
);
${next}`;
}

const SERVER_TEST = `import { expect, test } from "vitest";
import { handle } from "./server.ts";

test("reports health", async () => {
  const response = handle(new Request("http://localhost/healthz"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers 404 elsewhere", () => {
  expect(handle(new Request("http://localhost/")).status).toBe(404);
});
`;

/**
 * The tracker Dockerfile's stages for a service with no workspace
 * dependencies. `pins` are that Dockerfile's syntax and base-image lines, so
 * the new image starts on the digests the fleet already runs.
 */
function dockerfile(
  { name, port }: ServiceOptions,
  pins: { syntax: string; base: string },
): string {
  const workspace = `@shepherdjerred/${name}`;
  return `${pins.syntax}
${pins.base}
WORKDIR /app

# ── manifests: only the install closure's workspace manifests ───────────────
# Every manifest reaches this cheap stage; installs copy only its output, so an
# edit to a package outside the closure keeps their cache keys and layers.
FROM base AS manifests
COPY --parents \\
  package.json scripts/package.json \\
  packages/*/package.json packages/*/packages/*/package.json \\
  packages/docs/wiki/package.json \\
  packages/homelab/src/cdk8s/package.json \\
  packages/homelab/src/helm-types/package.json \\
  /workspace/
COPY --parents \\
  ci/scripts/images/workspace-manifests.ts \\
  ci/scripts/selectors/select-image-targets-workspaces.ts \\
  ci/scripts/selectors/select-image-targets-lockfile.ts \\
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \\
  '${workspace}'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '${workspace}'

# Add each workspace dependency's directory to this COPY and to the runtime
# stage's as the service gains them.
FROM deps AS build
COPY --parents tsconfig.base.json packages/${name} packages/eslint-config ./
RUN cd packages/${name} && bun run build

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '${workspace}'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/${name} /app/packages/${name}
WORKDIR /app/packages/${name}
# The Bugsink release; declared after the build steps so it never busts caches.
ARG VERSION=dev
ENV VERSION=\${VERSION}
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE ${String(port)}
USER 1000:1000
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=${name}
ENV CI_IMAGE_SMOKE_TARGET=\${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
`;
}

const RESOURCES = `{
          cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
          memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
        }`;

function environment(port: number): string {
  return `{
          // Bun writes runtime state under $HOME; the root filesystem is
          // read-only, so HOME points at the writable emptyDir.
          HOME: EnvValue.fromValue("/tmp"),
          HOST: EnvValue.fromValue("0.0.0.0"),
          PORT: EnvValue.fromValue("${String(port)}"),
          ENVIRONMENT: EnvValue.fromValue("production"),
        }`;
}

function activationGate(name: string): string {
  return `/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const ${activationConstant(name)} = false;`;
}

function webResourceSource(options: ServiceOptions & { host: string }): string {
  const { name, port, host } = options;
  return `import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "${HOMELAB}/misc/common.ts";
import { FirstPartyWebService } from "${HOMELAB}/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
} from "${HOMELAB}/misc/network-policies.ts";
import { firstPartyImageRecipe } from "${HOMELAB}/versions.ts";

${activationGate(name)}

export function create${pascalCase(name)}Deployment(chart: Chart) {
  return new FirstPartyWebService(chart, "${name}-web-service", {
    name: "${name}",
    port: ${String(port)},
    probes: { live: "/healthz", ready: "/healthz" },
    containers: () => ({
      server: {
        image: firstPartyImageRecipe("${name}"),
        securityContext: restrictedContainer(1000),
        resources: ${RESOURCES},
        envVariables: ${environment(port)},
      },
    }),
    serviceName: "${name}",
    tailscale: {
      probePath: "/healthz",
      hosts: [{ id: "${name}-ingress", host: "${host}" }],
    },
    policies: [
      {
        name: "${name}-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [tcp(${String(port)})],
          },
        ],
        // Add an egress rule for each dependency the service calls.
        egress: [dnsEgressRule()],
      },
    ],
  });
}
`;
}

function workerResourceSource({ name, port }: ServiceOptions): string {
  return `import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue, Volume } from "cdk8s-plus-31";
import { restrictedContainer } from "${HOMELAB}/misc/common.ts";
import { httpProbes } from "${HOMELAB}/misc/first-party/kubelet-probes.ts";
import { FirstPartyWorker } from "${HOMELAB}/misc/first-party/worker.ts";
import {
  dnsEgressRule,
  prometheusIngressRule,
} from "${HOMELAB}/misc/network-policies.ts";
import { firstPartyImageRecipe } from "${HOMELAB}/versions.ts";

${activationGate(name)}

export function create${pascalCase(name)}Deployment(chart: Chart) {
  return new FirstPartyWorker(chart, "${name}-worker", {
    name: "${name}",
    deployment: { podMetadata: { labels: { app: "${name}" } } },
    containers: () => ({
      main: {
        name: "${name}",
        image: firstPartyImageRecipe("${name}"),
        securityContext: restrictedContainer(1000),
        resources: ${RESOURCES},
        ports: [{ number: ${String(port)}, name: "health" }],
        ...httpProbes(${String(port)}, { live: "/healthz", ready: "/healthz" }),
        envVariables: ${environment(port)},
        volumeMounts: [
          {
            path: "/tmp",
            volume: Volume.fromEmptyDir(chart, "${name}-tmp", "tmp"),
          },
        ],
      },
    }),
    policies: [
      {
        name: "${name}-app-netpol",
        selects: "app",
        // A worker has no ingress beyond what Prometheus scrapes.
        ingress: [prometheusIngressRule([${String(port)}])],
        // Add an egress rule for each dependency the worker calls.
        egress: [dnsEgressRule()],
      },
    ],
  });
}
`;
}

function chartSource({ name }: ServiceOptions): string {
  const pascal = pascalCase(name);
  const gate = activationConstant(name);
  return `import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { ConfigMap, Namespace } from "cdk8s-plus-31";
import {
  ${gate},
  create${pascal}Deployment,
} from "${HOMELAB}/resources/${name}/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function create${pascal}Chart(app: App, active = ${gate}) {
  const chart = new Chart(app, "${name}", {
    namespace: "${name}",
    disableResourceNameHashes: true,
  });
  if (!active) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  new Namespace(chart, "${name}-namespace", { metadata: { name: "${name}" } });
  create${pascal}Deployment(chart);
  return chart;
}
`;
}

function chartTestSource({ name, kind }: ServiceOptions): string {
  const pascal = pascalCase(name);
  return `import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { create${pascal}Chart } from "${HOMELAB}/cdk8s-charts/${name}.ts";
import { resetProbeRegistry } from "${HOMELAB}/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  const resources = create${pascal}Chart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated service renders its workload", () => {
  const kinds = z
    .array(Manifest)
    .parse(create${pascal}Chart(new App(), true).toJson())
    .map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "NetworkPolicy",${kind === "web" ? '\n      "Service",\n      "Ingress",' : ""}
    ]),
  );
});
`;
}

function applicationSource({ name }: ServiceOptions): string {
  const gate = activationConstant(name);
  return `import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "${HOMELAB}/misc/argo/application.ts";
import { ${gate} } from "${HOMELAB}/resources/${name}/index.ts";

export function create${pascalCase(name)}App(chart: Chart, active = ${gate}) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "${name}",
    namespace: "${name}",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
`;
}

function helmChart({ name, title }: ServiceOptions): string {
  return `apiVersion: v2
name: ${name}
description: ${title}
type: application
version: "$version"
appVersion: "$appVersion"
`;
}

export function resourceSource(options: ServiceOptions): string {
  if (options.kind === "worker") return workerResourceSource(options);
  if (options.host === undefined)
    throw new Error("A web service needs --host, its tailnet hostname");
  return webResourceSource({ ...options, host: options.host });
}

/** Every file the scaffolder creates beyond the base package scaffold. */
export function serviceFiles(
  options: ServiceOptions,
  pins: { syntax: string; base: string },
): Readonly<Record<string, string>> {
  const { name } = options;
  const source = `${CDK8S_ROOT}/src`;
  return {
    [`packages/${name}/Dockerfile`]: dockerfile(options, pins),
    [`packages/${name}/src/index.ts`]: entrypointSource(options),
    [`packages/${name}/src/server.ts`]: serverSource(options),
    [`packages/${name}/src/server.test.ts`]: SERVER_TEST,
    [`${source}/resources/${name}/index.ts`]: resourceSource(options),
    [`${source}/cdk8s-charts/${name}.ts`]: chartSource(options),
    [`${source}/cdk8s-charts/${name}.test.ts`]: chartTestSource(options),
    [`${source}/resources/argo-applications/apps/${name}.ts`]:
      applicationSource(options),
    [`${CDK8S_ROOT}/helm/${name}/Chart.yaml`]: helmChart(options),
  };
}
