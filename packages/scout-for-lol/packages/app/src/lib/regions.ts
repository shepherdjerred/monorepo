export const REGIONS = [
  { value: "AMERICA_NORTH", label: "NA", name: "North America" },
  { value: "EU_WEST", label: "EUW", name: "Europe West" },
  { value: "EU_EAST", label: "EUNE", name: "Europe Nordic & East" },
  { value: "KOREA", label: "KR", name: "Korea" },
  { value: "JAPAN", label: "JP", name: "Japan" },
  { value: "BRAZIL", label: "BR", name: "Brazil" },
  { value: "LAT_NORTH", label: "LAN", name: "Latin America North" },
  { value: "LAT_SOUTH", label: "LAS", name: "Latin America South" },
  { value: "OCEANIA", label: "OCE", name: "Oceania" },
  { value: "TURKEY", label: "TR", name: "Turkey" },
  { value: "RUSSIA", label: "RU", name: "Russia" },
  { value: "VIETNAM", label: "VN", name: "Vietnam" },
  { value: "TAIWAN", label: "TW", name: "Taiwan" },
  { value: "SINGAPORE", label: "SG", name: "Singapore" },
  { value: "PBE", label: "PBE", name: "Public Beta Environment" },
] as const;

export type RegionValue = (typeof REGIONS)[number]["value"];

export function findRegion(value: string): RegionValue | null {
  const match = REGIONS.find((region) => region.value === value);
  return match?.value ?? null;
}

/**
 * Short display label for a region (e.g. `EU_WEST` → `EUW`), falling back to
 * the raw value so an unrecognised region is still shown rather than hidden.
 */
export function regionLabel(value: string): string {
  return REGIONS.find((region) => region.value === value)?.label ?? value;
}

/**
 * Full display name for a region (e.g. `AMERICA_NORTH` → `North America`),
 * falling back to short label or raw value.
 */
export function regionName(value: string): string {
  return (
    REGIONS.find((region) => region.value === value)?.name ?? regionLabel(value)
  );
}
