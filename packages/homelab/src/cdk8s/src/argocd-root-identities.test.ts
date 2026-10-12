import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const ResourceSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.object({ name: z.string(), namespace: z.string().optional() }),
  })
  .loose();

async function resources() {
  const source = await Bun.file(
    new URL("../dist/apps.k8s.yaml", import.meta.url),
  ).text();
  return parseAllDocuments(source).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

test("root resources have unique group/kind/name release selectors", async () => {
  const identities = new Map<string, string[]>();
  for (const resource of await resources()) {
    const separator = resource.apiVersion.indexOf("/");
    const group =
      separator === -1 ? "" : resource.apiVersion.slice(0, separator);
    const identity = `${group}/${resource.kind}/${resource.metadata.name}`;
    const namespaces = identities.get(identity) ?? [];
    namespaces.push(resource.metadata.namespace ?? "<cluster>");
    identities.set(identity, namespaces);
  }

  expect(
    [...identities].filter(([, namespaces]) => namespaces.length > 1),
  ).toEqual([]);
});

const SecretKeyRefSchema = z.object({
  secretKeyRef: z.object({ name: z.string(), key: z.string() }),
});
const SecretVolumeSchema = z.object({
  secret: z.object({ secretName: z.string() }),
});

function secretReferences(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap((entry: unknown) => secretReferences(entry));
  if (typeof value !== "object" || value === null) return [];
  const keyRef = SecretKeyRefSchema.safeParse(value);
  const volume = SecretVolumeSchema.safeParse(value);
  return [
    ...(keyRef.success ? [keyRef.data.secretKeyRef.name] : []),
    ...(volume.success ? [volume.data.secret.secretName] : []),
    ...Object.values(value).flatMap((entry: unknown) =>
      secretReferences(entry),
    ),
  ];
}

test("monitoring consumers reference their namespace's declared credentials", async () => {
  const rendered = await resources();
  for (const [applicationName, namespace] of [
    ["prometheus", "prometheus"],
    ["tempo", "tempo"],
    ["alloy-gateway", "alloy-gateway"],
  ] as const) {
    const item = rendered.find(
      (resource) =>
        resource.kind === "OnePasswordItem" &&
        resource.metadata.namespace === namespace &&
        resource.metadata.name.endsWith("monitoring-api-auth"),
    );
    const application = rendered.find(
      (resource) =>
        resource.kind === "Application" &&
        resource.metadata.name === applicationName,
    );
    if (item === undefined || application === undefined) {
      throw new Error(
        `Missing monitoring credentials or Application for ${namespace}`,
      );
    }
    const references = secretReferences(application["spec"]);
    expect(references).toContain(item.metadata.name);
    expect(references).not.toContain("monitoring-api-auth");
  }
});
