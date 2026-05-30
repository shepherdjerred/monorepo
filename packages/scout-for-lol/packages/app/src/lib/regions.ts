export const REGIONS = [
  { value: "AMERICA_NORTH", label: "NA" },
  { value: "EU_WEST", label: "EUW" },
  { value: "EU_EAST", label: "EUNE" },
  { value: "KOREA", label: "KR" },
  { value: "JAPAN", label: "JP" },
  { value: "BRAZIL", label: "BR" },
  { value: "LAT_NORTH", label: "LAN" },
  { value: "LAT_SOUTH", label: "LAS" },
  { value: "OCEANIA", label: "OCE" },
  { value: "TURKEY", label: "TR" },
  { value: "RUSSIA", label: "RU" },
  { value: "VIETNAM", label: "VN" },
  { value: "TAIWAN", label: "TW" },
  { value: "SINGAPORE", label: "SG" },
  { value: "PBE", label: "PBE" },
] as const;

export type RegionValue = (typeof REGIONS)[number]["value"];

export function findRegion(value: string): RegionValue | null {
  const match = REGIONS.find((region) => region.value === value);
  return match?.value ?? null;
}
