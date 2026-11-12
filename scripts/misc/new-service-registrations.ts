import { z } from "zod";
import {
  activationConstant,
  pascalCase,
  smokePort,
} from "./new-service-files.ts";
import type { ServiceOptions } from "./new-service-options.ts";

/**
 * The places outside its own files where `new-service.ts` registers a hosted
 * service, as edits to the files that exist. Each edit is a function from the
 * file's text to its new text and fails when the file no longer has the shape
 * it expects, so a moved anchor is found here and not in review.
 *
 * `scripts/checks/service-registration.ts` is the specification: it reads
 * these same files and lists whatever a service is missing.
 */

const CDK8S_SOURCE = "packages/homelab/src/cdk8s/src";

export type RegistrationEdit = {
  file: string;
  /**
   * How prettier lays the file's JSON out: `expanded` keeps every object on
   * its own lines, `compact` lets one that fits share a line. Unset for a
   * text edit.
   */
  json?: "expanded" | "compact";
  apply: (text: string) => string;
};

/** Inserts `text` before the one occurrence of `anchor`. */
function insertBefore(
  source: string,
  anchor: string,
  text: string,
  file: string,
): string {
  const index = source.indexOf(anchor);
  if (index === -1 || source.includes(anchor, index + anchor.length))
    throw new Error(
      `${file}: expected exactly one ${JSON.stringify(anchor)} to insert before`,
    );
  return `${source.slice(0, index)}${text}${source.slice(index)}`;
}

const DocumentSchema = z.record(z.string(), z.unknown());

function stringEntry(entry: unknown): string {
  return z.string().parse(entry);
}
function entryId(entry: unknown): string {
  return z.looseObject({ id: z.string() }).parse(entry).id;
}
function entryName(entry: unknown): string {
  return z.looseObject({ name: z.string() }).parse(entry).name;
}

/**
 * Adds `entry` to the list under `key` of a JSON document. Every other key
 * and entry stays as written, in its place. A `sorted` list takes the entry
 * before the first one that orders after it; any other list takes it last.
 */
function addToList(
  text: string,
  edit: {
    file: string;
    key: string;
    entry: unknown;
    identify: (entry: unknown) => string;
    sorted?: boolean;
  },
): string {
  const document = DocumentSchema.parse(JSON.parse(text));
  const list = z.array(z.unknown()).parse(document[edit.key]);
  const ids = list.map((entry) => edit.identify(entry));
  const added = edit.identify(edit.entry);
  if (ids.includes(added))
    throw new Error(`${edit.file} already declares ${added} in ${edit.key}`);
  const after = edit.sorted === true ? ids.findIndex((id) => id > added) : -1;
  return JSON.stringify({
    ...document,
    [edit.key]: list.toSpliced(
      after === -1 ? list.length : after,
      0,
      edit.entry,
    ),
  });
}

/**
 * The catalog entry of a prepared service. It owns its image and chart, and
 * its chart is excluded from the root release as inactive. It has no Argo
 * Application, deploy variant, environment or Delivery delegation: those are
 * the activation change.
 */
function catalogService({ name, title }: ServiceOptions) {
  return {
    id: name,
    title,
    package: name,
    lifecycle: "active",
    selfHosted: false,
    group: name,
    components: [
      { name: `image:${name}`, producer: "first-party" },
      { name: `chart:${name}`, producer: "first-party" },
    ],
    ops: { kind: "product", namespaces: [name] },
    legacy: {
      rootReleaseExclusions: { [name]: "inactive" },
      charts: [name],
    },
  };
}

/** The ops view of `catalogService`, as `services.json` spells it. */
function opsService({ name, title }: ServiceOptions) {
  return {
    id: name,
    rootReleaseExclusions: { [name]: "inactive" },
    images: [name],
    charts: [name],
    title,
    kind: "product",
    package: name,
    namespaces: [name],
    argoApps: [],
  };
}

function smokeCommand({ name, port }: ServiceOptions): string {
  const url = `http://127.0.0.1:${String(smokePort(port))}/healthz`;
  return `  ${JSON.stringify(name)}: {
    command: [
      "set -eu",
      "cd /app/packages/${name}",
      "bun src/index.ts >/tmp/${name}-smoke.log 2>&1 &",
      "pid=$!",
      "trap 'if kill -0 $pid; then kill $pid; wait $pid || test $? -eq 143; fi' EXIT",
      "for _ in $(seq 1 30); do",
      \`  if bun -e 'const health = await fetch("${url}"); if (!health.ok) process.exit(1);'; then exit 0; fi\`,
      "  if ! kill -0 $pid; then cat /tmp/${name}-smoke.log; exit 1; fi",
      "  sleep 1",
      "done",
      "cat /tmp/${name}-smoke.log",
      "exit 1",
    ].join("\\n"),
    env: {
      HOST: "127.0.0.1",
      PORT: "${String(smokePort(port))}",
    },
  },
`;
}

function bakeTarget(name: string): string {
  return `target "${name}" {
  inherits   = ["_app"]
  dockerfile = "packages/${name}/Dockerfile"
  tags       = imagetags("${name}")
  cache-from = cachefrom("${name}")
  cache-to   = cacheto("${name}")
}

`;
}

function registerBakeTarget(text: string, name: string): string {
  const file = "docker-bake.hcl";
  const group = /^group "app" \{\n {2}targets = \[\n(?: {4}"[^"]+",\n)+/mu.exec(
    text,
  );
  if (group === null)
    throw new Error(`${file}: expected the group "app" target list`);
  const end = group.index + group[0].length;
  return insertBefore(
    `${text.slice(0, end)}    "${name}",\n${text.slice(end)}`,
    "# ── Homelab infra images",
    bakeTarget(name),
    file,
  );
}

function exemptPreparedChart(text: string, name: string): string {
  const document = DocumentSchema.parse(JSON.parse(text));
  const charts = z
    .record(z.string(), z.string())
    .parse(document["chartsWithoutRecipe"]);
  return JSON.stringify({
    ...document,
    chartsWithoutRecipe: {
      ...charts,
      [name]: `prepared service: ${activationConstant(name)} is false, so no Application renders and no recipe exists until activation`,
    },
  });
}

/** Every edit to an existing file, in the order they are applied. */
export function registrationEdits(
  options: ServiceOptions,
): readonly RegistrationEdit[] {
  const { name, title } = options;
  const pascal = pascalCase(name);
  const catalog = "packages/ops-model/catalog-document.json";
  return [
    {
      file: "package.json",
      json: "compact",
      apply: (text) =>
        addToList(text, {
          file: "package.json",
          key: "workspaces",
          entry: `packages/${name}`,
          identify: stringEntry,
          sorted: true,
        }),
    },
    {
      file: "packages/version-catalog/src/image-registry.json",
      json: "compact",
      apply: (text) =>
        addToList(text, {
          file: "image-registry.json",
          key: "images",
          entry: { name, visibility: "private" },
          identify: entryName,
          sorted: true,
        }),
    },
    {
      file: "ci/scripts/images/image-targets.ts",
      apply: (text) =>
        insertBefore(
          text,
          "} as const satisfies Readonly<Record<string, ImageTargetRegistration>>;",
          `  ${JSON.stringify(name)}: { owner: "@shepherdjerred/${name}" },\n`,
          "image-targets.ts",
        ),
    },
    {
      file: "docker-bake.hcl",
      apply: (text) => registerBakeTarget(text, name),
    },
    {
      file: "ci/scripts/images/smoke-app-in-image.ts",
      apply: (text) =>
        insertBefore(
          text,
          "};\n\nconst command = commands[target];",
          smokeCommand(options),
          "smoke-app-in-image.ts",
        ),
    },
    {
      file: catalog,
      json: "expanded",
      apply: (text) =>
        addToList(
          addToList(text, {
            file: catalog,
            key: "groups",
            entry: { id: name, title, kind: "product", package: name },
            identify: entryId,
          }),
          {
            file: catalog,
            key: "services",
            entry: catalogService(options),
            identify: entryId,
          },
        ),
    },
    {
      // `sources.test.ts` in ops-model holds this equal to the catalog's view.
      file: "packages/ops-model/services.json",
      json: "compact",
      apply: (text) =>
        addToList(text, {
          file: "services.json",
          key: "services",
          entry: opsService(options),
          identify: entryId,
        }),
    },
    {
      file: "scripts/checks/service-registration-exemptions.json",
      json: "expanded",
      apply: (text) => exemptPreparedChart(text, name),
    },
    {
      file: `${CDK8S_SOURCE}/setup-charts.ts`,
      apply: (text) =>
        insertBefore(
          insertBefore(
            text,
            "/**\n * Sets up all charts",
            `import { create${pascal}Chart } from "./cdk8s-charts/${name}.ts";\n\n`,
            "setup-charts.ts",
          ),
          "  // Must run last: reads the probe registry",
          `  create${pascal}Chart(app);\n\n`,
          "setup-charts.ts",
        ),
    },
    {
      file: `${CDK8S_SOURCE}/cdk8s-charts/apps.ts`,
      apply: (text) =>
        insertBefore(
          insertBefore(
            text,
            "export async function createAppsChart",
            `import { create${pascal}App } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/${name}.ts";\n\n`,
            "apps.ts",
          ),
          "  // ArgoCD AppProject",
          `  create${pascal}App(chart);\n\n`,
          "apps.ts",
        ),
    },
  ];
}
