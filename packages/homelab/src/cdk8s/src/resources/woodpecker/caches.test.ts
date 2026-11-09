import { expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import {
  CI_WORKSPACE_VOLUME_SIZE,
  NVME_STORAGE_CLASS_LZ4,
} from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import {
  renderedClaims,
  type ClaimManifest,
} from "@shepherdjerred/homelab/cdk8s/src/testing/claim-manifest-schema.ts";
import {
  createWoodpeckerCaches,
  WOODPECKER_MISE_INSTALLS_CLAIM,
  WOODPECKER_WORKSPACE_GOLDEN_CLAIM,
} from "./caches.ts";

function renderClaims(): ClaimManifest[] {
  const chart = new Chart(new App(), "caches");
  createWoodpeckerCaches(chart);
  return renderedClaims(chart.toJson());
}

test("only the golden claim, unbound until its first refresh, is left out of application health", () => {
  const claims = renderClaims();
  const ignored = claims
    .filter(
      (claim) =>
        claim.metadata.annotations?.[
          "argocd.argoproj.io/ignore-healthcheck"
        ] === "true",
    )
    .map((claim) => claim.metadata.name);
  expect(ignored).toEqual([WOODPECKER_WORKSPACE_GOLDEN_CLAIM]);
  expect(claims.length).toBeGreaterThan(1);
});

test("workspaces and the golden claim share one whole-GiB size, so a clone equals its snapshot", () => {
  // ZFS rounds a volume up to whole GiB; a decimal size would leave the
  // snapshot larger than the clones that request it.
  expect(CI_WORKSPACE_VOLUME_SIZE).toMatch(/^[1-9]\d*Gi$/u);
  const golden = renderClaims().find(
    (claim) => claim.metadata.name === WOODPECKER_WORKSPACE_GOLDEN_CLAIM,
  );
  expect(golden?.spec.resources.requests.storage).toBe(
    CI_WORKSPACE_VOLUME_SIZE,
  );
});

test("the mise install claim is a shared, disposable NVMe cache sized for months of version bumps", () => {
  const claims = renderClaims();
  const claim = claims.find(
    (entry) => entry.metadata.name === WOODPECKER_MISE_INSTALLS_CLAIM,
  );
  expect(WOODPECKER_MISE_INSTALLS_CLAIM).toBe("woodpecker-mise-installs");
  expect(claim).toBeDefined();
  expect(claim?.metadata.namespace).toBe("woodpecker-ci");
  expect(claim?.spec.resources.requests.storage).toBe("20Gi");
  // Many step pods, on any lane, install into it concurrently.
  expect(claim?.spec.accessModes).toEqual(["ReadWriteMany"]);
  expect(claim?.spec.storageClassName).toBe(NVME_STORAGE_CLASS_LZ4);
  // Re-installable from mise.lock, so never backed up.
  expect(claim?.metadata.labels).toEqual({
    "velero.io/backup": "disabled",
    "velero.io/exclude-from-backup": "true",
  });
  // Unlike the golden claim it needs no health exemption: it binds like every
  // other cache claim, so ArgoCD must keep reporting on it.
  expect(claim?.metadata.annotations).toBeUndefined();
});
