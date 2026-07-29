import { z } from "zod";
import { fetchJson } from "./fetch.ts";
import {
  compactList,
  humanizeIdentifier,
  type KnowledgeRecord,
  type Sources,
} from "./model.ts";

const RegionSchema = z.strictObject({
  parent_map: z.string().nullable(),
  has_grass: z.boolean(),
  has_water: z.boolean(),
  has_fishing: z.boolean(),
  locations: z.array(z.string()),
  events: z.array(z.string()),
  exits: z.array(z.string()),
  warps: z.array(z.string()),
});

const RegionsSchema = z.record(z.string(), RegionSchema);
const REGION_FILES = [
  "battle_frontier",
  "cities",
  "dungeons",
  "islands",
  "routes",
];

function rawUrl(sources: Sources, path: string): string {
  return `https://raw.githubusercontent.com/ArchipelagoMW/Archipelago/${sources.archipelago.commit}/${sources.archipelago.worldPath}/${path}`;
}

export async function buildWorldRecords(
  sources: Sources,
): Promise<KnowledgeRecord[]> {
  const records: KnowledgeRecord[] = [];
  for (const file of REGION_FILES) {
    const url = rawUrl(sources, `data/regions/${file}.json`);
    const regions = RegionsSchema.parse(await fetchJson(url));
    for (const [id, region] of Object.entries(regions)) {
      const map = region.parent_map ?? "No parent map";
      const features = [
        region.has_grass ? "grass encounters" : undefined,
        region.has_water ? "surfable water" : undefined,
        region.has_fishing ? "fishing" : undefined,
      ].filter((value) => value !== undefined);
      records.push({
        id: `world:${id.toLowerCase()}`,
        domain: "world",
        title: humanizeIdentifier(id.replace("REGION_", "")),
        aliases: [id, map, humanizeIdentifier(map.replace("MAP_", ""))],
        tags: [file, map, ...features],
        body: [
          `Region: ${id}`,
          `Parent map: ${map}`,
          `Terrain/features: ${features.join(", ") || "none recorded"}`,
          `Connected regions: ${compactList(region.exits) || "none"}`,
          `Warps: ${compactList(region.warps) || "none"}`,
          `Locations and rewards: ${compactList(region.locations) || "none"}`,
          `Events: ${compactList(region.events) || "none"}`,
        ].join("\n"),
        source: {
          id: "archipelago",
          url,
          license: sources.archipelago.license,
          revision: sources.archipelago.commit,
        },
      });
    }
  }
  return records;
}
