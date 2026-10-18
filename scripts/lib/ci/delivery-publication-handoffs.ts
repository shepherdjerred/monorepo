import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { ChartPublicationSchema } from "@shepherdjerred/ops-model/chart-publication.ts";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { readOptionalHandoff, readRequiredHandoff } from "./ci-handoff.ts";
import { DELIVERY_IMAGE_DIGESTS_HANDOFF } from "./image-publication-handoff.ts";

export const ChartInventorySchema = z.array(
  z.object({
    name: z.string().regex(/^[\w-]+$/u),
    revision: z.string().min(1),
    prune: z.boolean().optional(),
    digest: ArtifactInputSchema.shape.digest.optional(),
  }),
);
export const SitePublicationSchema = z.object({
  serviceId: z.string().min(1),
  artifact: ArtifactInputSchema,
});

const TrmnlPublicationSchema = SitePublicationSchema.extend({
  serviceId: z.literal("trmnl-dashboard"),
})
  .strict()
  .refine(
    ({ artifact }) =>
      artifact.kind === "archive" &&
      artifact.component === "archive:trmnl-plugins" &&
      artifact.origin.kind === "first-party" &&
      artifact.uri ===
        `s3://delivery-artifacts/trmnl-plugins/${artifact.digest.slice(7)}.json` &&
      /^sha256:[a-f0-9]{64}$/u.test(
        artifact.requires["image:trmnl-dashboard"] ?? "",
      ),
    "TRMNL publication requires its original content-addressed plugin archive and exact backend dependency",
  );

const HANDOFF_READERS = {
  required: readRequiredHandoff,
  optional: readOptionalHandoff,
};

export async function readPublicationHandoffs(
  staticArchives: boolean,
  read: {
    required: typeof readRequiredHandoff;
    optional: typeof readOptionalHandoff;
  } = HANDOFF_READERS,
) {
  const digests: unknown = JSON.parse(
    await read.required(DELIVERY_IMAGE_DIGESTS_HANDOFF),
  );
  const rawCharts = await read.optional("argocd-release-expected");
  const chartPublication =
    rawCharts === undefined
      ? undefined
      : ChartPublicationSchema.parse(
          JSON.parse(await read.required("delivery-chart-publications")),
        );
  const rootInventory =
    rawCharts === undefined
      ? undefined
      : ChartInventorySchema.parse(JSON.parse(rawCharts));
  if (chartPublication !== undefined) {
    const inventory = z
      .array(ChartInventorySchema.element)
      .parse(rootInventory);
    const index = new ServiceIndex(SERVICE_CATALOG);
    if (
      chartPublication.charts.some((fresh) => {
        const expected = inventory.find((chart) => chart.name === fresh.name);
        return expected === undefined
          ? index.byChart(fresh.name)?.rootReleaseExclusions?.[fresh.name] !==
              "inactive"
          : expected.revision !== fresh.revision;
      })
    )
      throw new Error(
        "Fresh chart publication does not match the coordinated release inventory",
      );
  }
  const charts = chartPublication?.charts;
  const trmnl = z
    .array(TrmnlPublicationSchema)
    .max(1)
    .parse(JSON.parse(await read.required("trmnl-plugin-artifacts")));
  if (!staticArchives)
    return {
      digests,
      charts,
      chartPublication,
      rootInventory,
      siteArtifacts: trmnl,
    };
  const [rawSites, rawScout] = await Promise.all([
    read.required("site-artifacts"),
    read.required("scout-site-artifacts"),
  ]);
  const siteArtifacts = z
    .array(SitePublicationSchema.strict())
    .parse(JSON.parse(rawSites));
  const scout = z
    .array(
      SitePublicationSchema.extend({
        serviceId: z.literal("scout-for-lol"),
      }).strict(),
    )
    .parse(JSON.parse(rawScout));
  for (const entry of [...siteArtifacts, ...scout])
    if (entry.artifact.kind !== "archive")
      throw new Error(
        "Static publication requires an immutable archive artifact",
      );
  for (const entry of scout)
    if (!siteArtifacts.some((aggregate) => isDeepStrictEqual(aggregate, entry)))
      throw new Error(
        "Static aggregate omitted or changed a Scout producer artifact",
      );
  return {
    digests,
    charts,
    chartPublication,
    rootInventory,
    siteArtifacts: [...siteArtifacts, ...trmnl],
  };
}
