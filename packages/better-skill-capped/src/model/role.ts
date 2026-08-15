export const ROLES = ["top", "jungle", "mid", "adc", "support", "all"] as const;

export type Role = (typeof ROLES)[number];

export function parseRole(input: string): Role {
  const lowered = input.toLowerCase();
  const match = ROLES.find((role) => role === lowered);
  if (match === undefined) {
    throw new Error(`Unknown role: ${input}`);
  }
  return match;
}

const DISPLAY_NAMES: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  adc: "ADC",
  support: "Support",
  all: "Not Role Specific",
};

export function roleDisplayName(role: Role): string {
  return DISPLAY_NAMES[role];
}
