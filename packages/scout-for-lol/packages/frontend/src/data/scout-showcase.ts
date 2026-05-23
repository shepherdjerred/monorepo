import { z } from "zod";
import rawShowcaseAssets from "./generated/scout-showcase-assets.json";

const ShowcaseStateSchema = z.enum(["prematch", "postmatch"]);

const BaseScoutShowcaseAssetSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  group: z.string().min(1),
  description: z.string().min(1).optional(),
  state: ShowcaseStateSchema.optional(),
  queue: z.string().min(1).optional(),
  playerCount: z.number().int().positive().optional(),
  sourceKeys: z.array(z.string().min(1)),
});

export const GeneratedScoutShowcaseAssetSchema =
  BaseScoutShowcaseAssetSchema.extend({
    kind: z.enum(["s3-image", "competition-graph", "report-graph"]),
    status: z.literal("generated"),
    fileName: z.string().min(1),
    src: z.string().min(1),
    byteLength: z.number().int().positive(),
  });

const UnsupportedScoutShowcaseAssetSchema = BaseScoutShowcaseAssetSchema.extend(
  {
    kind: z.literal("unsupported"),
    status: z.literal("unsupported"),
    reason: z.string().min(1),
  },
);

const ScoutShowcaseAssetSchema = z.discriminatedUnion("status", [
  GeneratedScoutShowcaseAssetSchema,
  UnsupportedScoutShowcaseAssetSchema,
]);

const ScoutShowcaseAssetIndexSchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  assets: z.array(ScoutShowcaseAssetSchema),
});

const scoutShowcaseAssetIndex =
  ScoutShowcaseAssetIndexSchema.parse(rawShowcaseAssets);

export const generatedScoutShowcaseAssets =
  scoutShowcaseAssetIndex.assets.flatMap((asset) =>
    asset.status === "generated" ? [asset] : [],
  );
