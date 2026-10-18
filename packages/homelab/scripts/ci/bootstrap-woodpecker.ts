#!/usr/bin/env bun
/** One-time pre-ownership bootstrap; all selected state and receipts stay outside Git. */
import path from "node:path";
import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  BootstrapDescriptorSchema,
  BootstrapApplicationSchema,
  assertBootstrapOwnershipOff,
  assertBootstrapRootPaused,
  assertBootstrapSnapshot,
  bootstrapFingerprint,
} from "./bootstrap-selection.ts";
import {
  assertBootstrapCheckout,
  assertBootstrapRegistryEmpty,
  bootstrapArgo,
  bootstrapSourceCas,
  bootstrapSourceProof,
  bootstrapOperationReceipt,
  captureBootstrapApplications,
  captureParentArchive,
  rereadBootstrapApplications,
  verifyBootstrapImages,
} from "./bootstrap-native.ts";
import {
  prepareBootstrapArchives,
  publishBootstrapArchive,
} from "./bootstrap-publication.ts";
import {
  assertExternalBootstrapPath,
  createBootstrapDirectory,
} from "./bootstrap-output.ts";
import { bootstrapCredentials } from "./bootstrap-auth.ts";
import {
  verifyBootstrapControlPlane,
  verifyBootstrapControlPlaneArchive,
} from "./bootstrap-control-plane.ts";

function argumentsForBootstrap() {
  const [descriptorFile, outputFlag, output, ...flags] = Bun.argv.slice(2);
  if (
    descriptorFile === undefined ||
    outputFlag !== "--output" ||
    output === undefined ||
    flags.some((flag) => flag !== "--dry-run")
  )
    throw new Error(
      "Usage: bootstrap-woodpecker.ts <descriptor.json> --output <NEW-private-directory> [--dry-run]",
    );
  const directory = path.resolve(output);
  const repository = new URL("../../../../", import.meta.url).pathname;
  assertExternalBootstrapPath(repository, directory);
  return {
    descriptorFile,
    directory,
    repository,
    dryRun: flags.includes("--dry-run"),
  };
}

/** Reuse the existing root lifecycle and scoped application sync before ownership transfer. */
export async function releaseBootstrapRoot(input: {
  descriptor: {
    targets: readonly string[];
    revision: string;
    requestId: string;
  };
  expectedPath: string;
  credentials: { ARGOCD_TOKEN: string; ARGOCD_WORKLOAD_TOKEN?: string };
  run: (
    args: string[],
    credentials: Record<string, string>,
  ) => Promise<unknown>;
}) {
  const { descriptor, credentials } = input;
  const identity = [
    "--revision",
    descriptor.revision,
    "--request-id",
    descriptor.requestId,
  ];
  const root = { ARGOCD_TOKEN: credentials.ARGOCD_TOKEN };
  if (descriptor.targets.includes("delivery")) {
    const workload = z.string().min(1).parse(credentials.ARGOCD_WORKLOAD_TOKEN);
    await input.run(["stage-root-release", "apps", ...identity], root);
    await input.run(["sync-managed", "delivery", ...identity], {
      ARGOCD_TOKEN: workload,
    });
  }
  await input.run(
    ["release-root", "apps", input.expectedPath, ...identity],
    root,
  );
}

async function main() {
  const { descriptorFile, directory, repository, dryRun } =
    argumentsForBootstrap();
  const descriptor = BootstrapDescriptorSchema.parse(
    await Bun.file(descriptorFile).json(),
  );
  await assertBootstrapCheckout(descriptor.sourceRevision);
  const sourceProof = await bootstrapSourceProof(descriptor);
  await bootstrapCredentials(
    undefined,
    descriptor.targets.includes("delivery"),
  );
  const captured = await captureBootstrapApplications();
  assertBootstrapOwnershipOff(captured.applications);
  await assertBootstrapRegistryEmpty(
    captured.applications,
    descriptor.deliveryUrl,
  );
  assertBootstrapRootPaused(captured.root);
  const parent = await captureParentArchive(captured.root);
  await verifyBootstrapImages(descriptor);
  await createBootstrapDirectory(repository, directory);
  await verifyBootstrapControlPlane(descriptor.controlPlane, directory);
  await verifyBootstrapControlPlaneArchive(descriptor.controlPlane);
  type Receipt = {
    schema: string;
    descriptor: typeof descriptor;
    sourceProof: typeof sourceProof;
    parentRootArchive: typeof parent;
    originalRoot: typeof captured.root;
    originalApplications: typeof captured.applications;
    prepared: Awaited<ReturnType<typeof prepareBootstrapArchives>> | null;
    events: unknown[];
    status: string;
    eligibleForDelivery: boolean;
    applicationAccepted: boolean;
  };
  const receipt: Receipt = {
    schema: "delivery-bootstrap-receipt/v1",
    descriptor,
    sourceProof,
    parentRootArchive: parent,
    originalRoot: captured.root,
    originalApplications: captured.applications,
    prepared: null,
    events: [],
    status: "preparing",
    eligibleForDelivery: false,
    applicationAccepted: false,
  };
  const receiptPath = path.join(directory, "receipt.json");
  const checkpoint = async (event: unknown) => {
    receipt.events.push(event);
    await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
  };
  await checkpoint({ kind: "captured", at: new Date().toISOString() });
  try {
    receipt.prepared = await prepareBootstrapArchives(
      descriptor,
      captured,
      directory,
    );
    const expectedPath = path.join(directory, "expected.json");
    await Bun.write(
      expectedPath,
      JSON.stringify(receipt.prepared.expected) + "\n",
      { mode: 0o600 },
    );
    receipt.status = "prepared";
    await checkpoint({
      kind: "archives-prepared",
      at: new Date().toISOString(),
    });
    if (dryRun) {
      console.log(
        JSON.stringify({
          receipt: receiptPath,
          status: "prepared",
          effects: false,
        }),
      );
      return;
    }
    await assertBootstrapCheckout(descriptor.sourceRevision);
    await bootstrapSourceProof(descriptor);
    await verifyBootstrapControlPlane(descriptor.controlPlane, directory);
    await verifyBootstrapControlPlaneArchive(descriptor.controlPlane);
    assertBootstrapSnapshot(
      captured.applications,
      await rereadBootstrapApplications(captured.applications),
    );
    // Pin selected existing ranges to their already-running revision before publishing any newer leaf.
    const pinned = [...captured.applications];
    for (const target of descriptor.targets) {
      const index = pinned.findIndex((app) => app.metadata.name === target),
        prior = pinned[index];
      if (prior === undefined) continue;
      await assertBootstrapRegistryEmpty(
        await rereadBootstrapApplications(pinned),
        descriptor.deliveryUrl,
      );
      const source = z.record(z.string(), z.json()).parse(prior.spec["source"]);
      await checkpoint({
        kind: "source-freeze-intent",
        application: target,
        uid: prior.metadata.uid,
        priorSourceFingerprint: bootstrapFingerprint(source),
        requestId: descriptor.requestId,
      });
      pinned[index] = await bootstrapSourceCas(prior, {
        ...source,
        targetRevision: prior.status.sync.revision,
      });
      await checkpoint({
        kind: "source-frozen",
        application: target,
        uid: pinned[index].metadata.uid,
      });
    }
    for (const archive of receipt.prepared.archives) {
      await assertBootstrapRegistryEmpty(
        await rereadBootstrapApplications(pinned),
        descriptor.deliveryUrl,
      );
      assertBootstrapSnapshot(
        pinned,
        await rereadBootstrapApplications(pinned),
      );
      await checkpoint({
        kind: "publication-intent",
        name: archive.name,
        digest: archive.digest,
      });
      await publishBootstrapArchive(archive);
      await checkpoint({
        kind: "published",
        name: archive.name,
        digest: archive.digest,
      });
    }
    await bootstrapSourceProof(descriptor);
    await verifyBootstrapControlPlane(descriptor.controlPlane, directory);
    await verifyBootstrapControlPlaneArchive(descriptor.controlPlane);
    await assertBootstrapRegistryEmpty(
      await rereadBootstrapApplications(pinned),
      descriptor.deliveryUrl,
    );
    assertBootstrapSnapshot(pinned, await rereadBootstrapApplications(pinned));
    const currentRoot = BootstrapApplicationSchema.parse(
      await bootstrapArgo("/apps"),
    );
    if (
      currentRoot.metadata.uid !== captured.root.metadata.uid ||
      bootstrapFingerprint(currentRoot.spec) !==
        bootstrapFingerprint(captured.root.spec)
    )
      throw new Error(
        "Root identity/source changed before owned bootstrap release",
      );
    await checkpoint({
      kind: "root-release-intent",
      requestId: descriptor.requestId,
      revision: descriptor.revision,
    });
    const rootCredentials = await bootstrapCredentials(
      undefined,
      descriptor.targets.includes("delivery"),
    );
    await releaseBootstrapRoot({
      descriptor,
      expectedPath,
      credentials: rootCredentials,
      run: (args, credentials) =>
        run(
          [
            "bun",
            "--no-install",
            path.join(repository, "packages/homelab/scripts/argocd/argocd.ts"),
            ...args,
          ],
          {
            cwd: directory,
            env: credentials,
            unsetEnv: [
              "OP_SERVICE_ACCOUNT_TOKEN",
              "ROOT_ARGOCD_TOKEN",
              "ARGOCD_AUTH_TOKEN",
              "ARGOCD_WORKLOAD_TOKEN",
            ],
          },
        ),
    });
    const operations = [];
    for (const name of ["apps", ...descriptor.targets])
      operations.push(
        bootstrapOperationReceipt(
          await bootstrapArgo(`/${encodeURIComponent(name)}`),
          descriptor.requestId,
        ),
      );
    receipt.status = "completed";
    await checkpoint({
      kind: "native-operation-readback",
      operations,
      at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        receipt: receiptPath,
        status: "completed",
        applicationAccepted: false,
      }),
    );
  } catch (error) {
    receipt.status = "interrupted";
    await checkpoint({
      kind: "interrupted",
      at: new Date().toISOString(),
      instruction:
        "Inspect exact receipt and owned root request before resuming release-root; no PG lock or acceptance exists",
    });
    throw error;
  }
}
if (import.meta.main) await main();
