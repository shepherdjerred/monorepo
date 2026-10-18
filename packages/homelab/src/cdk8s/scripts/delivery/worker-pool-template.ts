import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";

const Resource = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});
const PROFILES = {
  temporal: {
    target: "central",
    prefix: "temporal-workflows-",
    repository: "temporal-worker",
    profile: "central-workflows",
  },
  "scout-beta": {
    target: "scout-beta",
    prefix: "scout-workflow-worker-",
    repository: "scout-for-lol",
    profile: "scout-beta-workflows",
  },
  "scout-prod": {
    target: "scout-prod",
    prefix: "scout-workflow-worker-",
    repository: "scout-for-lol",
    profile: "scout-prod-workflows",
  },
} as const;

function poolValidation(profile: (typeof PROFILES)[keyof typeof PROFILES]) {
  return `{{ $pool := mustFromJson (required "Delivery requires workerPool" (get (.Values.delivery | default dict) "workerPool")) }}
{{ if or (ne $pool.schema "delivery-worker-pool/v1") (ne $pool.target "${profile.target}") }}{{ fail "Worker pool identity mismatch" }}{{ end }}
{{ if or (lt (len $pool.versions) 1) (gt (len $pool.versions) 1000) }}{{ fail "Worker pool size invalid" }}{{ end }}
{{ $seen := dict }}
{{ range $worker := $pool.versions }}
{{ if or (ne $worker.host.profile "${profile.profile}") (ne $worker.environmentId $pool.environmentId) (not (regexMatch "^[a-f0-9]{40}$" $worker.buildId)) (not (regexMatch "^docker[.]io/shepherdjerred/${profile.repository}@sha256:[a-f0-9]{64}$" $worker.image)) (not (has (int $worker.replicas) (list 0 1))) }}{{ fail "Worker host input invalid" }}{{ end }}
{{ $track := printf "retained-%s" (trunc 12 $worker.buildId) }}
{{ if hasKey $seen $track }}{{ fail "Worker host name collision" }}{{ end }}{{ $_ := set $seen $track true }}
{{ end }}
`;
}

/** Exact expressions emitted by the fixed worker template; unknown consumer syntax remains forbidden. */
export function workerPoolExpressions(chart: string): string[] {
  const parsed = z
    .enum(["temporal", "scout-beta", "scout-prod"])
    .safeParse(chart);
  if (!parsed.success) return [];
  return [
    ...[
      ...poolValidation(PROFILES[parsed.data]).matchAll(/\{\{[^{}]*\}\}/gu),
    ].map((match) => match[0]),
    "{{ range $worker := $pool.versions }}",
    '{{ $track := printf "retained-%s" (trunc 12 $worker.buildId) }}',
    "{{ $track }}",
    "{{ $worker.image | quote }}",
    "{{ $worker.replicas }}",
    "{{ end }}",
    "{{ $worker.buildId | quote }}",
  ];
}

function retainedPrototype(value: unknown, candidatePrefix: string): unknown {
  if (typeof value === "string")
    return value === "candidate"
      ? "DELIVERYTRACK"
      : value
          .replaceAll(
            `${candidatePrefix}candidate`,
            "delivery-wf-DELIVERYTRACK",
          )
          .replaceAll("workflows-candidate", "workflows-DELIVERYTRACK");
  if (Array.isArray(value))
    return value.map((entry: unknown) =>
      retainedPrototype(entry, candidatePrefix),
    );
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      retainedPrototype(entry, candidatePrefix),
    ]),
  );
}

function prototypeManifest(
  resource: z.infer<typeof Resource>,
  prefix: string,
): string {
  const prepared = Resource.parse(retainedPrototype(resource, prefix));
  if (resource.kind === "Deployment") {
    const deployment = z
      .looseObject({
        spec: z.looseObject({
          replicas: z.number(),
          template: z.looseObject({
            metadata: z.looseObject({
              labels: z.record(z.string(), z.string()),
            }),
            spec: z.looseObject({
              containers: z
                .array(z.looseObject({ image: z.string() }))
                .length(1),
            }),
          }),
        }),
      })
      .parse(prepared);
    deployment.spec.replicas = 99_117;
    deployment.spec.template.metadata.labels[
      "delivery.shepherdjerred.com/worker-build"
    ] = "DELIVERYBUILDID";
    const container = deployment.spec.template.spec.containers[0];
    if (container === undefined)
      throw new Error("Missing worker prototype container");
    container.image = "DELIVERYIMAGE";
    const env = z
      .array(z.looseObject({ name: z.string() }))
      .parse(container["env"]);
    if (env.some((entry) => entry.name === "TEMPORAL_WORKER_BUILD_ID"))
      throw new Error("Worker prototype already overrides its baked Build ID");
    container["env"] = [
      ...env,
      { name: "TEMPORAL_WORKER_BUILD_ID", value: "DELIVERYBUILDID" },
    ];
    prepared["spec"] = deployment.spec;
  }
  let rendered = stringify(prepared, { lineWidth: 0 })
    .replaceAll("DELIVERYTRACK", "{{ $track }}")
    .replaceAll("DELIVERYBUILDID", "{{ $worker.buildId | quote }}")
    .replaceAll("DELIVERYIMAGE", "{{ $worker.image | quote }}")
    .replaceAll("replicas: 99117", "replicas: {{ $worker.replicas }}");
  // The serializer may quote the image sentinel in future; fail instead of emitting nested quotes.
  if (rendered.includes('"{{ $worker.image | quote }}"'))
    throw new Error("Worker image serialization changed");
  rendered = rendered.replaceAll(
    /(argocd\.argoproj\.io\/sync-wave:) [^\n]+/gu,
    '$1 "-2"',
  );
  return rendered;
}

/** Use the source-owned candidate host recipe; PG supplies only identity, image and replicas. */
export function workerPoolTemplate(manifest: string, chart: string): string {
  if (!(chart in PROFILES)) return manifest;
  const profile =
    PROFILES[z.enum(["temporal", "scout-beta", "scout-prod"]).parse(chart)];
  const documents = parseAllDocuments(manifest).map((document) => {
    if (document.errors.length > 0)
      throw new Error("Invalid worker chart YAML");
    return Resource.parse(document.toJSON() as unknown);
  });
  const prototype: string[] = [];
  const ordinary: string[] = [];
  for (const resource of documents) {
    const name = resource.metadata.name;
    if (!name.includes(profile.prefix)) {
      ordinary.push(stringify(resource, { lineWidth: 0 }));
      continue;
    }
    if (name.includes(`${profile.prefix}candidate`))
      prototype.push(prototypeManifest(resource, profile.prefix));
  }
  if (prototype.length === 0)
    throw new Error(`Missing ${chart} candidate worker prototype`);
  const template = `${ordinary.join("---\n")}---\n${poolValidation(profile)}{{ range $worker := $pool.versions }}\n{{ $track := printf "retained-%s" (trunc 12 $worker.buildId) }}\n${prototype.join("---\n")}---\n{{ end }}\n`;
  // Helm evaluates directives even in YAML comments. Preserve raw YAML syntax
  // for artifact inventories; Kubernetes validation still uses Helm-rendered values.
  return template.replaceAll(/^(\{\{[^\n]*)$/gmu, "# $1");
}
