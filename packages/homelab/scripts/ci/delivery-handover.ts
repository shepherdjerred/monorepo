#!/usr/bin/env bun
/** One coordinated native authority transfer. No source selection, PG acceptance or deployment is performed here. */
import path from "node:path";
import { open, rename } from "node:fs/promises";
import { z } from "zod";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import {
  bootstrapSourceProof,
  assertBootstrapCheckout,
} from "./bootstrap-native.ts";
import { createBootstrapDirectory } from "./bootstrap-output.ts";
import {
  bootstrapFingerprint,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";
import {
  HandoverDescriptorSchema,
  handoverContext,
  handoverContextFingerprint,
  handoverPatch,
  handoverApplicationIdentity,
  assertHandoverRoot,
  type HandoverDescriptor,
} from "./delivery-handover-selection.ts";
import {
  handoverJson,
  handoverAutomation,
} from "./delivery-handover-native.ts";
import {
  createHandoverArgo,
  loadHandoverCredentials,
} from "./delivery-handover-access.ts";

type Effects = {
  catalog?: Catalog;
  context: () => Promise<unknown>;
  applications: () => Promise<BootstrapApplication[]>;
  root: () => Promise<unknown>;
  sourceProof: () => Promise<unknown>;
  automation: () => Promise<unknown>;
  access: () => Promise<unknown>;
  patch: ReturnType<typeof createHandoverArgo>["patch"];
  checkpoint: (event: unknown) => Promise<void>;
};

/** Every external mutation is preceded by a fresh independent PG/native read; maintenance quiescence provides cross-system exclusion. */
export async function transferDeliveryOwnership(
  descriptor: HandoverDescriptor,
  effects: Effects,
  dryRun = false,
) {
  const sourceProof = await effects.sourceProof();
  const access = await effects.access();
  const contextRaw = await effects.context();
  const context = handoverContext(contextRaw, descriptor, effects.catalog);
  const pgFingerprint = handoverContextFingerprint(contextRaw);
  let applications = await effects.applications();
  const root = assertHandoverRoot(
    await effects.root(),
    descriptor.targets.map((target) => target.application),
  );
  const automation = await effects.automation();
  const rootIdentity = handoverApplicationIdentity(root);
  for (const target of descriptor.targets) {
    const registered = context.targets.find(
      (row) => row.environmentId === target.environmentId,
    );
    const original = applications.find(
      (app) => app.metadata.name === target.application,
    );
    if (registered === undefined || original === undefined)
      throw new Error("Registered/native handover target is missing");
    handoverPatch(original, registered);
  }
  await effects.checkpoint({
    kind: "prepared",
    sourceProof,
    access,
    automation,
    context: contextRaw,
    root,
    applications,
  });
  if (dryRun) return { effects: false, transferred: [] };
  const transferred: string[] = [];
  for (const target of descriptor.targets) {
    const freshSourceProof = await effects.sourceProof();
    const freshAccess = await effects.access();
    const freshAutomation = await effects.automation();
    const freshRaw = await effects.context();
    handoverContext(freshRaw, descriptor, effects.catalog);
    if (handoverContextFingerprint(freshRaw) !== pgFingerprint)
      throw new Error(
        "Registered generation, pipeline, baseline or admission changed during handover",
      );
    const freshRoot = assertHandoverRoot(
      await effects.root(),
      descriptor.targets.map((item) => item.application),
    );
    if (handoverApplicationIdentity(freshRoot) !== rootIdentity)
      throw new Error("Root source/lifecycle changed during handover");
    const current = await effects.applications();
    if (
      bootstrapFingerprint(
        current.map((app) => handoverApplicationIdentity(app)),
      ) !==
      bootstrapFingerprint(
        applications.map((app) => handoverApplicationIdentity(app)),
      )
    )
      throw new Error(
        "Native Application inventory/source/lifecycle changed before ownership CAS",
      );
    const registered = context.targets.find(
      (row) => row.environmentId === target.environmentId,
    );
    const actual = current.find(
      (app) => app.metadata.name === target.application,
    );
    if (registered === undefined || actual === undefined)
      throw new Error("Handover target vanished");
    const { patch } = handoverPatch(actual, registered);
    await effects.checkpoint({
      kind: "ownership-intent",
      sourceProof: freshSourceProof,
      access: freshAccess,
      automation: freshAutomation,
      application: target.application,
      environmentId: target.environmentId,
      uid: actual.metadata.uid,
      resourceVersion: actual.metadata.resourceVersion,
      sourceFingerprint: bootstrapFingerprint(actual.spec["source"]),
      pgFingerprint,
      patch,
    });
    const updated = await effects.patch(target.application, patch);
    const expected = structuredClone(actual);
    expected.metadata.annotations["delivery.shepherdjerred.com/environment"] =
      target.environmentId;
    const changedPolicy = z
      .record(z.string(), z.json())
      .parse(patch.at(-1)?.value);
    expected.spec["syncPolicy"] = changedPolicy;
    if (
      handoverApplicationIdentity(updated) !==
      handoverApplicationIdentity(expected)
    )
      throw new Error(
        "Native ownership response differs from exact metadata-only handover",
      );
    applications = current.map((app) =>
      app.metadata.name === updated.metadata.name ? updated : app,
    );
    transferred.push(updated.metadata.name);
    await effects.checkpoint({
      kind: "ownership-readback",
      application: updated.metadata.name,
      uid: updated.metadata.uid,
      resourceVersion: updated.metadata.resourceVersion,
      sourceFingerprint: bootstrapFingerprint(updated.spec["source"]),
    });
  }
  return { effects: true, transferred };
}

async function main() {
  const [file, flag, output, ...options] = Bun.argv.slice(2);
  if (
    file === undefined ||
    flag !== "--output" ||
    output === undefined ||
    options.some((option) => option !== "--dry-run")
  )
    throw new Error(
      "Usage: delivery-handover.ts <descriptor.json> --output <NEW-private-directory> [--dry-run]",
    );
  const descriptor = HandoverDescriptorSchema.parse(
    await Bun.file(file).json(),
  );
  await assertBootstrapCheckout(descriptor.sourceRevision);
  const { credentials, references } = await loadHandoverCredentials();
  const argo = createHandoverArgo(credentials);
  const directory = path.resolve(output);
  await createBootstrapDirectory(
    new URL("../../../../", import.meta.url).pathname,
    directory,
  );
  const events: unknown[] = [];
  const receipt = {
    schema: "delivery-ownership-receipt/v1",
    descriptor,
    credentialReferences: references,
    events,
    status: "prepared",
    applicationAccepted: false,
  };
  const checkpoint = async (event: unknown) => {
    receipt.events.push(event);
    const temporary = path.join(
      directory,
      `receipt-${crypto.randomUUID()}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(receipt, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(directory, "receipt.json"));
  };
  try {
    const result = await transferDeliveryOwnership(
      descriptor,
      {
        context: () =>
          handoverJson([
            "toolkit",
            "deploy",
            "handover-context",
            "--machine",
            "--url",
            descriptor.deliveryUrl,
            "--json",
          ]),
        applications: argo.applications,
        root: argo.root,
        sourceProof: async () => {
          await assertBootstrapCheckout(descriptor.sourceRevision);
          return bootstrapSourceProof(descriptor);
        },
        automation: () => handoverAutomation(descriptor),
        access: () => argo.access(descriptor),
        patch: argo.patch,
        checkpoint,
      },
      options.includes("--dry-run"),
    );
    receipt.status = result.effects ? "completed" : "prepared";
    await checkpoint(result);
    console.log(
      JSON.stringify({
        receipt: path.join(directory, "receipt.json"),
        ...result,
        applicationAccepted: false,
      }),
    );
  } catch (error) {
    receipt.status = "interrupted";
    await checkpoint({
      kind: "interrupted",
      instruction:
        "Inspect exact native ownership/source and retained receipt; leave writes and old automation paused. No deployment was accepted.",
    });
    throw error;
  }
}
if (import.meta.main) await main();
