#!/usr/bin/env bun
import path from "node:path";
import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  DELIVERY_ARGO_ACCOUNTS,
  DELIVERY_ARGO_SERVER_SETTINGS,
} from "#cdk8s/src/resources/argo-applications/platform/delivery-rbac.ts";
import {
  assertBootstrapOwnershipOff,
  assertBootstrapRootPaused,
  BootstrapApplicationSchema,
  bootstrapFingerprint,
  BOOTSTRAP_DELIVERY_ORIGIN,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";
import {
  assertBootstrapCheckout,
  bootstrapArgo,
  bootstrapSourceCas,
  bootstrapSourceProof,
  bootstrapOperationReceipt,
  captureBootstrapApplications,
  assertBootstrapRegistryEmpty,
  rereadBootstrapApplications,
} from "./bootstrap-native.ts";
import { reviewedAccountSource } from "./bootstrap-account-policy.ts";
import { createBootstrapDirectory } from "./bootstrap-output.ts";
import { bootstrapCredentials } from "./bootstrap-auth.ts";

const Request = z.strictObject({
  schema: z.literal("delivery-argocd-account-bootstrap/v1"),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  pullRequest: z.number().int().positive(),
  deliveryUrl: z.literal(BOOTSTRAP_DELIVERY_ORIGIN).optional(),
  requestId: z.uuid(),
});

async function confirmNativePolicy(application: BootstrapApplication) {
  const values = z
    .object({
      helm: z.object({
        valuesObject: z.object({
          configs: z.object({
            cm: z.record(z.string(), z.json()),
            rbac: z.object({ "policy.csv": z.string() }),
          }),
        }),
      }),
    })
    .parse(application.spec["source"]).helm.valuesObject.configs;
  const resource = async (name: string) => {
    const query = new URLSearchParams({
      group: "",
      version: "v1",
      kind: "ConfigMap",
      namespace: "argocd",
      resourceName: name,
    });
    const result = z
      .object({ manifest: z.string() })
      .parse(await bootstrapArgo(`/argocd/resource?${query.toString()}`));
    return z
      .object({ data: z.record(z.string(), z.string()) })
      .parse(JSON.parse(result.manifest)).data;
  };
  const cm = await resource("argocd-cm"),
    rbac = await resource("argocd-rbac-cm");
  if ((rbac["policy.default"] ?? "") !== "")
    throw new Error(
      "Live Argo default role is not empty; scoped account bootstrap refuses inherited authority",
    );
  if ((rbac["policy.csv"] ?? "").trim() !== values.rbac["policy.csv"].trim())
    throw new Error(
      "Actual Argo RBAC differs from its native source; account bootstrap refuses drift",
    );
  for (const key of Object.keys({
    ...DELIVERY_ARGO_ACCOUNTS,
    ...DELIVERY_ARGO_SERVER_SETTINGS,
  })) {
    const declared = z
      .union([z.string(), z.boolean()])
      .optional()
      .parse(values.cm[key]);
    if (cm[key] !== (declared === undefined ? undefined : String(declared)))
      throw new Error("Actual Argo account differs from its native source");
  }
}

async function main() {
  const [file, flag, output, ...rest] = Bun.argv.slice(2);
  if (
    file === undefined ||
    flag !== "--output" ||
    output === undefined ||
    rest.some((value) => value !== "--dry-run")
  )
    throw new Error(
      "Usage: bootstrap-argocd-accounts.ts <request.json> --output <NEW-private-directory> [--dry-run]",
    );
  const request = Request.parse(await Bun.file(file).json());
  await assertBootstrapCheckout(request.sourceRevision);
  const proof = await bootstrapSourceProof(request);
  await bootstrapCredentials();
  const captured = await captureBootstrapApplications();
  assertBootstrapRootPaused(captured.root);
  assertBootstrapOwnershipOff(captured.applications);
  await assertBootstrapRegistryEmpty(
    captured.applications,
    request.deliveryUrl,
  );
  const original = BootstrapApplicationSchema.parse(
    await bootstrapArgo("/argocd"),
  );
  assertBootstrapRootPaused(original);
  const selected = reviewedAccountSource(original);
  await confirmNativePolicy(original);
  const directory = path.resolve(output);
  await createBootstrapDirectory(
    new URL("../../../../", import.meta.url).pathname,
    directory,
  );
  const receipt = {
    schema: "delivery-argocd-account-bootstrap-receipt/v1",
    request,
    proof,
    original,
    selectedSource: selected,
    selectedSourceFingerprint: bootstrapFingerprint(selected),
    status: "prepared",
    operation: null as unknown,
  };
  const destination = path.join(directory, "receipt.json");
  const checkpoint = async () => {
    await Bun.write(destination, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
  };
  await checkpoint();
  if (rest.includes("--dry-run")) {
    console.log(
      JSON.stringify({
        receipt: destination,
        status: "prepared",
        effects: false,
      }),
    );
    return;
  }
  await bootstrapSourceProof(request);
  await confirmNativePolicy(original);
  receipt.status = "selection-intent";
  await checkpoint();
  await assertBootstrapRegistryEmpty(
    await rereadBootstrapApplications(captured.applications),
    request.deliveryUrl,
  );
  await bootstrapSourceCas(original, selected);
  receipt.status = "selected";
  await checkpoint();
  await assertBootstrapRegistryEmpty(
    await rereadBootstrapApplications(captured.applications),
    request.deliveryUrl,
  );
  const rootCredentials = await bootstrapCredentials();
  await run(
    [
      "bun",
      "--no-install",
      new URL("../argocd/argocd.ts", import.meta.url).pathname,
      "sync-managed",
      "argocd",
      "--revision",
      original.status.sync.revision,
      "--request-id",
      request.requestId,
      "--timeout",
      "600",
    ],
    {
      env: rootCredentials,
      unsetEnv: [
        "OP_SERVICE_ACCOUNT_TOKEN",
        "ROOT_ARGOCD_TOKEN",
        "ARGOCD_AUTH_TOKEN",
      ],
    },
  );
  const observed = BootstrapApplicationSchema.parse(
    await bootstrapArgo("/argocd"),
  );
  if (
    observed.metadata.uid !== original.metadata.uid ||
    bootstrapFingerprint(observed.spec["source"]) !==
      bootstrapFingerprint(selected) ||
    observed.status.sync.revision !== original.status.sync.revision
  )
    throw new Error(
      "Argo account bootstrap did not preserve exact native chart/source identity",
    );
  receipt.operation = bootstrapOperationReceipt(
    await bootstrapArgo("/argocd"),
    request.requestId,
  );
  await confirmNativePolicy(observed);
  receipt.status = "completed";
  await checkpoint();
  console.log(
    JSON.stringify({
      receipt: destination,
      status: "completed",
      tokensIssued: false,
      applicationAccepted: false,
    }),
  );
}
if (import.meta.main) await main();
