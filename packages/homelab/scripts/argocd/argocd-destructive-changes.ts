/**
 * Changes the API server accepts but that destroy or irreversibly alter data:
 * Zalando PostgreSQL cluster edits and storage shrinks. The apply-safety
 * preflight (`argocd-apply-safety.ts`) reports each as a finding that blocks
 * the release.
 */
import { z } from "zod";
import { JsonObjectSchema, valueAt } from "./argocd-json-path.ts";

const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

// Kubernetes resource quantities: an integer or decimal, optionally scaled by
// a binary (Ki..Ei) or decimal (k..E, m) SI suffix, or written with an
// exponent (1e9). Storage requests on claims and Zalando volumes mix these
// freely, so a shrink check must compare bytes rather than strings.
const QUANTITY_PATTERN =
  /^(?<number>\d+(?:\.\d+)?)(?<suffix>[EGMPTkm]|[EGKMPT]i)?$/u;
const QUANTITY_EXPONENT_PATTERN =
  /^(?<number>\d+(?:\.\d+)?)e(?<exponent>[+-]?\d+)$/iu;
const QUANTITY_SCALES: Readonly<Record<string, number>> = {
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

/** A scalar field's text for comparison and messages; anything else as JSON. */
function scalarText(value: unknown): string {
  const scalar = ScalarSchema.safeParse(value);
  return scalar.success ? String(scalar.data) : JSON.stringify(value);
}

/**
 * An unreadable quantity is a broken contract, not a finding: a storage size
 * nobody can parse cannot be declared safe, so it fails the preflight closed
 * and names the field and resource.
 */
function quantityBytes(
  value: unknown,
  path: readonly string[],
  resourceIdentity: string,
): number {
  const text =
    typeof value === "number"
      ? value.toString()
      : typeof value === "string"
        ? value
        : undefined;
  const exponent = QUANTITY_EXPONENT_PATTERN.exec(text ?? "")?.groups;
  if (
    exponent?.["number"] !== undefined &&
    exponent["exponent"] !== undefined
  ) {
    return Number(exponent["number"]) * 10 ** Number(exponent["exponent"]);
  }
  const match = QUANTITY_PATTERN.exec(text ?? "")?.groups;
  const number = match?.["number"];
  const suffix = match?.["suffix"];
  const scale = suffix === undefined ? 1 : QUANTITY_SCALES[suffix];
  if (number === undefined || scale === undefined) {
    throw new Error(
      `Could not read quantity ${JSON.stringify(value)} at /${path.join("/")} for ${resourceIdentity}`,
    );
  }
  return Number(number) * scale;
}

/**
 * A storage request that moves backwards. Kubernetes refuses to shrink a
 * bound claim outright, and the Zalando operator resizes a cluster's PVC to
 * whatever `spec.volume.size` says, so a smaller target is either a rejected
 * apply mid-release or an attempt to shrink a live database volume.
 */
function storageShrinkFinding(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  path: readonly string[],
  resourceIdentity: string,
): string | undefined {
  const liveValue = valueAt(live, path);
  const targetValue = valueAt(target, path);
  if (
    liveValue === undefined ||
    targetValue === undefined ||
    targetValue === null
  ) {
    return undefined;
  }
  const liveBytes = quantityBytes(liveValue, path, resourceIdentity);
  const targetBytes = quantityBytes(targetValue, path, resourceIdentity);
  return targetBytes < liveBytes
    ? `${resourceIdentity} shrinks /${path.join("/")} from ${scalarText(liveValue)} to ${scalarText(targetValue)}`
    : undefined;
}

function removedMapKeys(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  path: readonly string[],
): readonly string[] {
  const liveMap = JsonObjectSchema.safeParse(valueAt(live, path));
  if (!liveMap.success) {
    return [];
  }
  const targetMap = JsonObjectSchema.safeParse(valueAt(target, path));
  const targetKeys = targetMap.success ? targetMap.data : {};
  return Object.keys(liveMap.data).filter(
    (key) => !Object.hasOwn(targetKeys, key),
  );
}

/**
 * A Zalando `postgresql` cluster is a database, and these changes to it are
 * destructive or irreversible even though the API server accepts every one
 * of them: the operator would run a major-version upgrade, resize or replace
 * the data volume, scale the cluster to nothing, drop TLS, or drop the roles
 * and databases the applications connect with. Each one is a deliberate,
 * human-run procedure, never a side effect of a release.
 */
function postgresqlClusterFindings(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  resourceIdentity: string,
): readonly string[] {
  const findings: string[] = [];
  const version = ["spec", "postgresql", "version"] as const;
  const liveVersion = valueAt(live, version);
  const targetVersion = valueAt(target, version);
  if (
    liveVersion !== undefined &&
    targetVersion !== undefined &&
    targetVersion !== null &&
    scalarText(liveVersion) !== scalarText(targetVersion)
  ) {
    findings.push(
      `${resourceIdentity} changes /spec/postgresql/version from ${scalarText(liveVersion)} to ${scalarText(targetVersion)}; major-version changes use the reviewed upgrade procedure`,
    );
  }
  const shrink = storageShrinkFinding(
    live,
    target,
    ["spec", "volume", "size"],
    resourceIdentity,
  );
  if (shrink !== undefined) {
    findings.push(shrink);
  }
  const instances = ["spec", "numberOfInstances"] as const;
  const liveInstances = valueAt(live, instances);
  if (
    typeof liveInstances === "number" &&
    liveInstances > 0 &&
    valueAt(target, instances) === 0
  ) {
    findings.push(
      `${resourceIdentity} scales /spec/numberOfInstances from ${liveInstances.toString()} to 0`,
    );
  }
  const storageClass = ["spec", "volume", "storageClass"] as const;
  const liveStorageClass = valueAt(live, storageClass);
  const targetStorageClass = valueAt(target, storageClass);
  if (
    typeof liveStorageClass === "string" &&
    targetStorageClass !== liveStorageClass
  ) {
    findings.push(
      `${resourceIdentity} changes /spec/volume/storageClass from ${liveStorageClass} to ${typeof targetStorageClass === "string" ? targetStorageClass : "(omitted)"}`,
    );
  }
  const targetTls = valueAt(target, ["spec", "tls"]);
  if (
    JsonObjectSchema.safeParse(valueAt(live, ["spec", "tls"])).success &&
    (targetTls === undefined || targetTls === null)
  ) {
    findings.push(`${resourceIdentity} removes /spec/tls`);
  }
  for (const map of ["users", "databases"] as const) {
    const removed = removedMapKeys(live, target, ["spec", map]);
    if (removed.length > 0) {
      findings.push(
        `${resourceIdentity} removes /spec/${map} ${removed.join(", ")}`,
      );
    }
  }
  return findings;
}

function isPostgresqlCluster(resource: {
  group?: string | undefined;
  kind: string;
}): boolean {
  // The Zalando CRD's kind really is lower-case; compare case-insensitively
  // so a differently cased report of the same group still gets the checks.
  return (
    resource.group === "acid.zalan.do" &&
    resource.kind.toLowerCase() === "postgresql"
  );
}

/**
 * Changes the API server accepts but that destroy or irreversibly alter
 * data, grouped by kind beside the immutable-field table above.
 */
export function destructiveChangeFindings(
  resource: { group?: string | undefined; kind: string },
  resourceIdentity: string,
  live: Record<string, unknown>,
  target: Record<string, unknown>,
): readonly string[] {
  if (isPostgresqlCluster(resource)) {
    return postgresqlClusterFindings(live, target, resourceIdentity);
  }
  if (resource.kind === "PersistentVolumeClaim") {
    const shrink = storageShrinkFinding(
      live,
      target,
      ["spec", "resources", "requests", "storage"],
      resourceIdentity,
    );
    return shrink === undefined ? [] : [shrink];
  }
  return [];
}
