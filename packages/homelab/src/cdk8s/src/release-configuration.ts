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

export function releaseChartRevisions(
  raw: string | undefined = Bun.env["HOMELAB_CHART_REVISIONS_JSON"],
): Readonly<Record<string, string>> | undefined {
  return raw === undefined
    ? undefined
    : ChartRevisionsSchema.parse(
        parseJson(raw, "HOMELAB_CHART_REVISIONS_JSON"),
      );
}
