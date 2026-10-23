import { describe, expect, test } from "vitest";
import { deliveryTofuGrants } from "homelab/src/delivery-platform-grants.ts";
import { deliveryJobManifest } from "./job-manifest.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  DeliveryJobRequestSchema,
  deliveryJobArchive,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";

const snapshot = {
  kind: "tofu-plan" as const,
  stack: "github" as const,
  source: {
    id: "build/5",
    sourceRevision: "e".repeat(40),
    repositoryId: 1,
    pipelineNumber: 5,
    ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/5",
  },
  prerequisites: [],
  policyFingerprint: "f".repeat(64),
};
const request: DeliveryJobRequest = {
  deploymentId: "deployment/plan",
  stageKey: "tofu-plan",
  recipe: "tofu-plan",
  runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
  sourceRevision: "e".repeat(40),
  input: snapshot,
};
const archive = {
  uri: "s3://delivery-artifacts/stacks/github/abc.tar",
  digest: `sha256:${"1".repeat(64)}`,
};

describe("reviewed isolated deployment Job recipes", () => {
  test("infrastructure recipes accept only the exact source-owned stacks and action", () => {
    expect(deliveryTofuGrants("cloudflare")).toContainEqual({
      env: "CLOUDFLARE_API_TOKEN",
      secret: "ci-cloudflare-credentials",
      key: "CLOUDFLARE_API_TOKEN",
    });
    for (const stack of [
      "argocd",
      "asuswrt",
      "application-secrets",
      "github;echo injected",
    ]) {
      expect(() => deliveryTofuGrants(stack)).toThrow();
    }
    expect(() =>
      deliveryTofuGrants({ stack: "github", action: "destroy" }),
    ).toThrow();
  });
  test("the root-release recipe no longer exists", () => {
    expect(
      DeliveryJobRequestSchema.safeParse({ ...request, recipe: "root-release" })
        .success,
    ).toBe(false);
    expect(DELIVERY_JOB_BOOTSTRAP).not.toContain("root-release");
  });
  test("a stack archive adds only the read-only artifact reader grant and changes the Job identity", () => {
    const checkout = deliveryJobManifest(request);
    const archived = deliveryJobManifest({
      ...request,
      input: { snapshot, archive },
    });
    expect(deliveryJobArchive(request)).toBeUndefined();
    expect(
      deliveryJobArchive({ ...request, input: { snapshot, archive } }),
    ).toEqual(archive);
    expect(archived.metadata?.name).not.toBe(checkout.metadata?.name);
    const secrets = (job: ReturnType<typeof deliveryJobManifest>) =>
      job
        .spec!.template.spec!.containers[0]!.env!.filter(
          (entry) => entry.valueFrom?.secretKeyRef !== undefined,
        )
        .map(
          (entry) =>
            `${entry.valueFrom?.secretKeyRef?.name ?? "?"}/${entry.name}`,
        );
    expect(secrets(archived)).toEqual([
      ...secrets(checkout),
      "delivery-archive-reader/DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID",
      "delivery-archive-reader/DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY",
    ]);
    expect(() =>
      deliveryJobManifest({
        ...request,
        input: { snapshot, archive: { ...archive, uri: "https://evil/x.tar" } },
      }),
    ).toThrow();
  });
  test("the bootstrap verifies the archive digest before extracting it", () => {
    const branch = DELIVERY_JOB_BOOTSTRAP.split(
      'if [ -n "$archive_uri" ]; then',
    )[1]?.split("fi\n")[0];
    if (branch === undefined) throw new Error("Archive branch is missing");
    expect(branch).toContain(
      "aws --endpoint-url https://seaweedfs-s3.tailnet-1a49.ts.net s3 cp",
    );
    expect(branch).toContain('test "$observed_digest" = "$archive_digest"');
    expect(branch.indexOf('test "$observed_digest"')).toBeLessThan(
      branch.indexOf("tar -xf"),
    );
    expect(branch).toContain(
      "export DELIVERY_STACK_ARCHIVE_DIR=/workspace/stack",
    );
    expect(DELIVERY_JOB_BOOTSTRAP).not.toContain(
      'DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY="',
    );
  });
});
