import { z } from "zod";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/);
const BuildVersionSchema = z.string().regex(/^2\.0\.0-\d+$/);
const ImageKeySchema = z
  .string()
  .refine(
    (key) =>
      imageRegistry.images.some(
        (image) => key === `shepherdjerred/${image.name}`,
      ) ||
      key === "shepherdjerred/the-storm-server/candidate" ||
      key === "shepherdjerred/the-storm-server/accepted",
    "Unknown first-party publication image",
  );
const ImageDigestsSchema = z.record(ImageKeySchema, DigestSchema);
const ChartRevisionsSchema = z.record(z.string().min(1), BuildVersionSchema);

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

/** Producer inputs are transient digests, never catalog defaults or deployment choices. */
export function publicationImageDigests(
  raw: string | undefined = Bun.env["HOMELAB_IMAGE_DIGESTS_JSON"],
): Readonly<Record<string, string>> {
  return raw === undefined
    ? {}
    : ImageDigestsSchema.parse(parseJson(raw, "HOMELAB_IMAGE_DIGESTS_JSON"));
}

/**
 * Transition rendering for the Delivery v2 cutover window
 * (`packages/delivery/docs/model.md`, section 8 and decisions X6 and X14).
 *
 * Off, every chart the running system deploys today renders exactly as it did
 * before the cutover work; the baseline and data-layer charts are synthesized
 * and published but nothing deploys them. On, the charts render what the
 * window's final v1 root release applies:
 *
 * - every root child is retained (`Prune=false`, lifecycle `retain`, no
 *   resources finalizer), and the lifecycle policy admits deleting the root
 *   once it carries the orphan annotation;
 * - the self-hosted PostgreSQL clusters, their TLS chain and Namespaces move
 *   from the `delivery` and `temporal` charts to `delivery-data` and
 *   `temporal-data`, whose Applications the root renders;
 * - children move to the `cluster` and `workloads` AppProjects, Delivery's
 *   ArgoCD account may create, update, delete and sync them, and only
 *   Delivery may write `spec.source`;
 * - mc-sandbox joins the CI ClusterQueue and reads its image allowlist from a
 *   deployment parameter; the Delivery monitor alert rules load.
 *
 * It is committed source rather than an environment variable so the window
 * turns it on with one reviewed change (this return value, the assertion in
 * `release-configuration.test.ts`, and the data layers' `inactive` root
 * exclusions in `packages/ops-model/services.json`), and the main pipeline
 * that change triggers publishes the exact root revision `release-root`
 * applies.
 */
export function transitionRendering(): boolean {
  return false;
}

export function releaseChartRevisions(
  raw: string | undefined = Bun.env["HOMELAB_CHART_REVISIONS_JSON"],
): Readonly<Record<string, string>> | undefined {
  return raw === undefined
    ? undefined
    : ChartRevisionsSchema.parse(
        parseJson(raw, "HOMELAB_CHART_REVISIONS_JSON"),
      );
}
