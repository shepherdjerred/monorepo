import { RegionSchema, toReadableRegion } from "@shepherdjerred/scout-data";

/**
 * Region choices for Discord command options
 * Used across multiple admin commands that require region selection
 * Values match RegionSchema enum values for proper validation
 */
export const REGION_CHOICES = RegionSchema.options.map((region) => ({
  name: toReadableRegion(region),
  value: region,
}));
