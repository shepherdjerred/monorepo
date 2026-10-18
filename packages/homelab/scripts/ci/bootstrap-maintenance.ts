import { z } from "zod";
import { reviewedAccountSource } from "./bootstrap-account-policy.ts";
import {
  bootstrapFingerprint,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";

function expectedMaintenanceSpec(
  app: BootstrapApplication,
  original: Record<string, z.JSONType>,
) {
  const expected = structuredClone(original);
  if (app.metadata.name !== "apps" && app.metadata.name !== "argocd")
    return expected;
  const policy = z.record(z.string(), z.json()).parse(expected["syncPolicy"]);
  const actual = z.record(z.string(), z.json()).parse(app.spec["syncPolicy"]);
  if (actual["automated"] === undefined) delete policy["automated"];
  else if (actual["automated"] === null) policy["automated"] = null;
  else {
    z.object({ enabled: z.literal(false) }).parse(actual["automated"]);
    policy["automated"] = {
      ...z.record(z.string(), z.json()).parse(policy["automated"]),
      enabled: false,
    };
  }
  expected["syncPolicy"] = policy;
  if (
    app.metadata.name === "argocd" &&
    bootstrapFingerprint(app.spec["source"]) !==
      bootstrapFingerprint(expected["source"])
  )
    expected["source"] = z
      .json()
      .parse(reviewedAccountSource({ ...app, spec: expected }));
  return expected;
}

/** Recognize only the explicit root/Argo maintenance pause and exact reviewed account prerequisite. */
export function assertBootstrapMaintenance(
  rawRoot: unknown,
  applications: BootstrapApplication[],
  manifests: string[],
) {
  const declared = new Map<string, Record<string, z.JSONType>>();
  for (const raw of manifests) {
    const value = z
      .object({
        kind: z.string(),
        metadata: z.object({ name: z.string() }),
        spec: z.record(z.string(), z.json()).optional(),
      })
      .parse(JSON.parse(raw));
    if (value.kind !== "Application") continue;
    if (declared.has(value.metadata.name))
      throw new Error("Duplicate prior root Application");
    declared.set(
      value.metadata.name,
      z.record(z.string(), z.json()).parse(value.spec),
    );
  }
  const drift = new Set<string>();
  for (const app of applications) {
    const original = declared.get(app.metadata.name);
    if (original === undefined)
      throw new Error("Live Application missing from immutable prior root");
    if (bootstrapFingerprint(original) === bootstrapFingerprint(app.spec))
      continue;
    const expected = expectedMaintenanceSpec(app, original);
    if (bootstrapFingerprint(expected) !== bootstrapFingerprint(app.spec))
      throw new Error(`Unreviewed native root drift for ${app.metadata.name}`);
    drift.add(app.metadata.name);
  }
  assertRootDrift(rawRoot, drift);
}

function assertRootDrift(rawRoot: unknown, drift: Set<string>) {
  const root = z
    .object({
      status: z.object({
        sync: z.object({ status: z.enum(["Synced", "OutOfSync"]) }),
        resources: z
          .array(
            z.object({
              kind: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
          )
          .optional(),
      }),
    })
    .parse(rawRoot);
  if (root.status.sync.status === "Synced") return;
  const resources = z
    .array(z.object({ kind: z.string(), name: z.string(), status: z.string() }))
    .parse(root.status.resources);
  if (drift.size === 0 || resources.every((item) => item.status === "Synced"))
    throw new Error(
      "Root OutOfSync is not explained by reviewed maintenance changes",
    );
  for (const item of resources)
    if (
      item.status !== "Synced" &&
      !(
        item.status === "OutOfSync" &&
        item.kind === "Application" &&
        drift.has(item.name)
      )
    )
      throw new Error(
        "Root shared-resource or unrelated drift prevents bootstrap",
      );
}
