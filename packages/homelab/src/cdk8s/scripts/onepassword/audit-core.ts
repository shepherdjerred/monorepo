import { z } from "zod";
import {
  VAULT_ID,
  type OpItem,
} from "homelab/src/cdk8s/scripts/onepassword-lib.ts";
import { jsonCredential } from "homelab/scripts/tofu/application-secrets.ts";
import { buildFieldMapping, resolveAuditItem } from "./field-map.ts";

export type AuditReference = {
  item: string;
  field?: string;
  jsonPath?: string;
  sectionId?: string;
  fieldId?: string;
  access?: "operator" | "onepassword" | "target";
  source: string;
  wholeItem?: boolean;
  managed?: boolean;
};
export type AuditCoverage = { inspected: string[]; gaps: string[] };
const RecordSchema = z.record(z.string(), z.unknown());
const ManifestSchema = z.object({
  kind: z.string().optional(),
  metadata: z
    .object({ namespace: z.string().optional(), name: z.string().optional() })
    .optional(),
  spec: z
    .object({
      itemPath: z.string().optional(),
      destination: z.object({ namespace: z.string().optional() }).optional(),
    })
    .optional(),
});
const VolumeSchema = z.object({
  secretName: z.string().optional(),
  name: z.string().optional(),
  items: z.array(z.object({ key: z.string() })).optional(),
});
type Manifest = z.infer<typeof ManifestSchema>;
type ReferenceCollection = {
  references: AuditReference[];
  bindings: Map<string, string[]>;
  unresolved: string[];
};

function addConsumption(
  into: Map<string, Set<string>>,
  name: string,
  key: string,
): void {
  const keys = into.get(name) ?? new Set<string>();
  keys.add(key);
  into.set(name, keys);
}

function collectVolume(node: unknown, into: Map<string, Set<string>>): void {
  const volume = VolumeSchema.safeParse(node);
  if (!volume.success) return;
  const name = volume.data.secretName ?? volume.data.name;
  if (name === undefined) return;
  if (volume.data.items === undefined) addConsumption(into, name, "*");
  else
    for (const item of volume.data.items) addConsumption(into, name, item.key);
}

function collectImagePulls(
  node: unknown,
  into: Map<string, Set<string>>,
): void {
  if (!Array.isArray(node)) return;
  for (const entry of node) {
    const image = z.object({ name: z.string() }).safeParse(entry);
    if (image.success) addConsumption(into, image.data.name, "*");
  }
}

/** Include optional consumers, envFrom, projected/whole volumes and opaque Helm refs. */
export function collectAuditConsumption(
  node: unknown,
  into: Map<string, Set<string>>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectAuditConsumption(child, into);
    return;
  }
  const parsed = RecordSchema.safeParse(node);
  if (!parsed.success) return;
  const object = parsed.data;
  const keyRef = z
    .object({ name: z.string(), key: z.string() })
    .safeParse(object["secretKeyRef"]);
  if (keyRef.success) addConsumption(into, keyRef.data.name, keyRef.data.key);
  const envFrom = z.object({ name: z.string() }).safeParse(object["secretRef"]);
  if (envFrom.success) addConsumption(into, envFrom.data.name, "*");
  collectVolume(object["secret"], into);
  collectImagePulls(object["imagePullSecrets"], into);
  for (const [key, value] of Object.entries(object)) {
    // Chart-specific names cannot prove which field the chart consumes.
    if (
      typeof value === "string" &&
      value !== "" &&
      /(?:existing.*secret|secretname|secretref)$/iu.test(key)
    )
      addConsumption(into, value, "*");
    collectAuditConsumption(value, into);
  }
}

function manifestLocation(manifest: Manifest, source: string): string {
  return `${source}:${manifest.metadata?.namespace ?? ""}/${manifest.metadata?.name ?? ""}`;
}

function collectBinding(
  manifest: Manifest,
  source: string,
  collection: ReferenceCollection,
): void {
  const { references, bindings, unresolved } = collection;
  const itemPath = /^vaults\/([^/]+)\/items\/(.+)$/u.exec(
    manifest.spec?.itemPath ?? "",
  );
  const location = manifestLocation(manifest, source);
  if (
    itemPath?.[1] !== VAULT_ID ||
    itemPath[2] === undefined ||
    manifest.metadata?.name === undefined
  ) {
    unresolved.push(`${location}: malformed or outside-vault item binding`);
    return;
  }
  const item = itemPath[2];
  const key = `${manifest.metadata.namespace ?? ""}/${manifest.metadata.name}`;
  bindings.set(key, [...(bindings.get(key) ?? []), item]);
  references.push({ item, source: location });
}

function collectManifestConsumers(
  raw: unknown,
  manifest: Manifest,
  source: string,
  collection: ReferenceCollection,
): void {
  const { references, bindings, unresolved } = collection;
  const namespace =
    manifest.kind === "Application"
      ? manifest.spec?.destination?.namespace
      : manifest.metadata?.namespace;
  const consumption = new Map<string, Set<string>>();
  collectAuditConsumption(raw, consumption);
  const location = `${source}:${namespace ?? ""}/${manifest.kind ?? ""}/${manifest.metadata?.name ?? ""}`;
  for (const [secret, fields] of consumption) {
    const key = `${namespace ?? ""}/${secret}`;
    const items = bindings.get(key);
    if (items === undefined) {
      unresolved.push(
        `${source}:${key}: no inspected 1Password binding (may be operator-generated)`,
      );
      continue;
    }
    for (const item of items)
      for (const field of fields)
        references.push({
          item,
          source: location,
          ...(field === "*"
            ? { wholeItem: true }
            : { field, access: "operator" as const }),
        });
  }
}

export function manifestAuditReferences(
  manifests: unknown[],
  source: string,
): {
  references: AuditReference[];
  unresolved: string[];
} {
  const references: AuditReference[] = [];
  const unresolved: string[] = [];
  const bindings = new Map<string, string[]>();
  const collection = { references, bindings, unresolved };
  for (const raw of manifests) {
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== "OnePasswordItem") continue;
    collectBinding(parsed.data, source, collection);
  }
  for (const raw of manifests) {
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind === "OnePasswordItem") continue;
    collectManifestConsumers(raw, parsed.data, source, collection);
  }
  return { references, unresolved: [...new Set(unresolved)].toSorted() };
}

/** Scan references only: never return source lines or surrounding content. */
export function sourceAuditReferences(
  text: string,
  source: string,
): AuditReference[] {
  const references: AuditReference[] = [];
  const pattern = /(["'`])(op:\/\/[^\n"'`]+)\1|op:\/\/[^\s"'`)}]+/gu;
  for (const match of text.matchAll(pattern)) {
    const parsed = /^op:\/\/([^/]+)\/([^/]+)\/([^?]+)(?:\?.*)?$/u.exec(
      match[2] ?? match[0],
    );
    if (parsed?.[1] !== VAULT_ID && parsed?.[1]?.toLowerCase() !== "homelab")
      continue;
    if (parsed[2] === undefined || parsed[3] === undefined) continue;
    references.push({
      item: parsed[2],
      field: parsed[3],
      source,
      access: "onepassword",
    });
  }
  return references;
}

/** Repo CI grants are emitted dynamically, so they don't exist in CDK8s pods. */
export function pipelineGrantManifest(text: string, source: string): unknown {
  const consumers: unknown[] = [];
  for (const match of text.matchAll(
    /grant\(\s*"([\w-]+)"\s*,\s*(?:"([\w.-]+)"|[A-Z_]+)/gu,
  )) {
    consumers.push(
      match[2] === undefined
        ? { secretRef: { name: match[1] } }
        : { secretKeyRef: { name: match[1], key: match[2] } },
    );
  }
  for (const match of text.matchAll(
    /secret:\s*"([\w-]+)"\s*,\s*key:\s*"([\w.-]+)"/gu,
  ))
    consumers.push({ secretKeyRef: { name: match[1], key: match[2] } });
  return {
    kind: "Pod",
    metadata: { namespace: "woodpecker-ci", name: source },
    consumers,
  };
}

const credentialName =
  /(?:password|passwd|secret|token|credential|api[_-]?key|secret[_-]?(?:access[_-]?)?key|private[_-]?key|bearer|signing[_-]?key|auth[_-]?key)$/iu;
const identifierName =
  /(?:username|account|client[_-]?id|access[_-]?key[_-]?id|application[_-]?id|guild[_-]?id|channel[_-]?id|project|organization|workspace|issuer|endpoint|url|dsn|user[_-]?agent|host|port|email|region|revision|public[_-]?key|notesPlain)$/iu;

type PrivateCredentialLocation = { path: string; value: string };
type OpField = NonNullable<OpItem["fields"]>[number];

function collectJsonCredentials(
  node: unknown,
  prefix: string,
  into: PrivateCredentialLocation[],
): void {
  if (Array.isArray(node)) {
    for (const [index, child] of node.entries())
      collectJsonCredentials(child, `${prefix}/${String(index)}`, into);
    return;
  }
  const parsed = RecordSchema.safeParse(node);
  if (!parsed.success) return;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!/^[A-Za-z_][\w-]{0,127}$/u.test(key)) continue;
    const next = `${prefix}/${key}`;
    if (
      typeof value === "string" &&
      value !== "" &&
      credentialName.test(key) &&
      !identifierName.test(key)
    )
      into.push({ path: next, value });
    else collectJsonCredentials(value, next, into);
  }
}

function structuredValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function fieldCredentialLocations(
  field: OpField,
  references: readonly AuditReference[],
): PrivateCredentialLocation[] {
  const label = field.label ?? field.id;
  if (
    field.value === undefined ||
    field.value === "" ||
    identifierName.test(label)
  )
    return [];
  const path = `${field.section?.id === undefined ? "" : `${field.section.id}/`}${field.id}`;
  const json = structuredValue(field.value);
  if (typeof json !== "object" || json === null) {
    return field.type === "CONCEALED" || credentialName.test(label)
      ? [{ path, value: field.value }]
      : [];
  }
  const result: PrivateCredentialLocation[] = [];
  collectJsonCredentials(json, `${path}#`, result);
  for (const reference of references.filter(
    (ref) =>
      ref.jsonPath !== undefined &&
      (ref.field === label || ref.field === field.id),
  )) {
    const value = jsonCredential(field.value, reference.jsonPath ?? "");
    const jsonFieldPath = `${path}#${reference.jsonPath ?? ""}`;
    if (
      value !== undefined &&
      !result.some((location) => location.path === jsonFieldPath)
    )
      result.push({ path: jsonFieldPath, value });
  }
  return result;
}

export function credentialLocations(
  item: OpItem,
  references: readonly AuditReference[] = [],
): PrivateCredentialLocation[] {
  return (item.fields ?? []).flatMap((field) =>
    fieldCredentialLocations(field, references),
  );
}

function mappingProblems(
  items: readonly OpItem[],
  fieldMapping: ReturnType<typeof buildFieldMapping>,
) {
  const unresolved: string[] = [];
  const unresolvedIds = new Set<string>();
  for (const mapping of fieldMapping.reference_mappings) {
    if (
      [
        "resolved",
        "whole-item",
        "item-binding",
        "missing-or-ambiguous-item",
      ].includes(mapping.status)
    )
      continue;
    unresolved.push(
      `${mapping.reference.source}: ${mapping.status} ${mapping.reference.item}/${mapping.reference.field ?? ""}`,
    );
    const item = resolveAuditItem(
      items,
      mapping.reference.item,
      mapping.reference.access === "onepassword",
    );
    if (item !== undefined) unresolvedIds.add(item.id);
  }
  for (const collision of fieldMapping.collisions)
    for (const location of collision.locations)
      unresolvedIds.add(location.item_id);
  return { unresolved, unresolvedIds };
}

export function buildVaultAudit(
  items: readonly OpItem[],
  references: readonly AuditReference[],
  coverage: AuditCoverage,
) {
  const fieldMapping = buildFieldMapping(items, references);
  const { unresolved, unresolvedIds } = mappingProblems(items, fieldMapping);
  const byItem = new Map<string, AuditReference[]>();
  for (const reference of references) {
    const item = resolveAuditItem(
      items,
      reference.item,
      reference.access === "onepassword",
    );
    if (item === undefined) {
      unresolved.push(
        `${reference.source}: missing or ambiguous item ${reference.item}`,
      );
      for (const candidate of items.filter(
        (entry) => entry.title === reference.item,
      ))
        unresolvedIds.add(candidate.id);
      continue;
    }
    byItem.set(item.id, [...(byItem.get(item.id) ?? []), reference]);
  }
  const equal = new Map<string, { item_id: string; field_path: string }[]>();
  for (const item of items)
    for (const field of credentialLocations(item, byItem.get(item.id))) {
      equal.set(field.value, [
        ...(equal.get(field.value) ?? []),
        { item_id: item.id, field_path: field.path },
      ]);
    }
  const duplicates = [...equal.values()]
    .filter((group) => group.length > 1)
    .map((locations) => ({
      classification: "duplicate-candidate",
      locations,
      decision:
        "retain pending issuer, identity, permissions, environment and rotation-owner review",
    }));
  const duplicateIds = new Set(
    duplicates.flatMap((group) =>
      group.locations.map((location) => location.item_id),
    ),
  );
  const inventory = items.map((item) => {
    const refs = byItem.get(item.id) ?? [];
    const protection: string[] = [];
    if (unresolvedIds.has(item.id))
      protection.push("unresolved or ambiguous consumer reference");
    if (refs.some((ref) => ref.managed === true))
      protection.push("OpenTofu-owned item or handoff");
    if (refs.some((ref) => ref.wholeItem === true))
      protection.push("whole-secret or opaque chart consumer");
    if ((item.files?.length ?? 0) > 0)
      protection.push("attachments require separate inspection");
    if (
      /recovery|backup|bootstrap|encryption|passphrase|certificate|talos|kubeconfig|kubernetes|tofu-credentials|onepassword|1password/iu.test(
        item.title,
      )
    )
      protection.push("recovery, bootstrap or persistent encryption material");
    if (coverage.gaps.length > 0 && refs.length === 0)
      protection.push("consumer coverage incomplete");
    const classifications = [
      refs.length === 0 ? "unreferenced-in-inspected-sources" : "referenced",
    ];
    if (duplicateIds.has(item.id)) classifications.push("duplicate-candidate");
    if (protection.length > 0) classifications.push("protected");
    if (unresolvedIds.has(item.id)) classifications.push("unresolved");
    return {
      id: item.id,
      title: item.title,
      version: item.version ?? null,
      category: item.category ?? null,
      classifications,
      protection,
      references: refs,
      fields: (item.fields ?? []).map((field) => ({
        id: field.id,
        label: field.label ?? null,
        section_id: field.section?.id ?? null,
        blank: (field.value ?? "") === "",
      })),
      disposition: "retain; no archive authorized by this audit",
    };
  });
  return {
    vault_id: VAULT_ID,
    field_mapping: fieldMapping,
    coverage,
    inventory,
    duplicates,
    unresolved: [...new Set(unresolved)].toSorted(),
    archive_ready: [],
  };
}
