import { z } from "zod";

const RecordSchema = z.record(z.string(), z.unknown());
const VolumeSchema = z.object({
  secretName: z.string().optional(),
  name: z.string().optional(),
  optional: z.boolean().optional(),
  items: z.array(z.object({ key: z.string() })).optional(),
});

function addConsumption(
  into: Map<string, Set<string>>,
  name: string,
  key: string,
): void {
  const keys = into.get(name) ?? new Set<string>();
  keys.add(key);
  into.set(name, keys);
}

function collectVolume(
  node: unknown,
  into: Map<string, Set<string>>,
  optional?: Map<string, boolean>,
): void {
  const volume = VolumeSchema.safeParse(node);
  if (!volume.success) return;
  const name = volume.data.secretName ?? volume.data.name;
  if (name === undefined) return;
  const keys = volume.data.items?.map((item) => item.key) ?? ["*"];
  for (const key of keys) {
    addConsumption(into, name, key);
    const reference = name + "/" + key;
    optional?.set(
      reference,
      (optional.get(reference) ?? true) && volume.data.optional === true,
    );
  }
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
  optional?: Map<string, boolean>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectAuditConsumption(child, into, optional);
    return;
  }
  const parsed = RecordSchema.safeParse(node);
  if (!parsed.success) return;
  const object = parsed.data;
  const keyRef = z
    .object({
      name: z.string(),
      key: z.string(),
      optional: z.boolean().optional(),
    })
    .safeParse(object["secretKeyRef"]);
  if (keyRef.success) {
    addConsumption(into, keyRef.data.name, keyRef.data.key);
    const key = keyRef.data.name + "/" + keyRef.data.key;
    optional?.set(
      key,
      (optional.get(key) ?? true) && keyRef.data.optional === true,
    );
  }
  const envFrom = z.object({ name: z.string() }).safeParse(object["secretRef"]);
  if (envFrom.success) addConsumption(into, envFrom.data.name, "*");
  collectVolume(object["secret"], into, optional);
  collectImagePulls(object["imagePullSecrets"], into);
  for (const [key, value] of Object.entries(object)) {
    // Chart-specific names cannot prove which field the chart consumes.
    if (
      typeof value === "string" &&
      value !== "" &&
      !(key.toLowerCase() === "secretname" && Array.isArray(object["items"])) &&
      /(?:existing.*secret|secretname|secretref)$/iu.test(key)
    )
      addConsumption(into, value, "*");
    collectAuditConsumption(value, into, optional);
  }
}
