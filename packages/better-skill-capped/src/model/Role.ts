export enum Role {
  TOP,
  JUNGLE,
  MID,
  ADC,
  SUPPORT,
  ALL,
}

export function roleFromString(input: string): Role {
  switch (input.toUpperCase()) {
    case "TOP":
      return Role.TOP;
    case "JUNGLE":
      return Role.JUNGLE;
    case "MID":
      return Role.MID;
    case "ADC":
      return Role.ADC;
    case "SUPPORT":
      return Role.SUPPORT;
    case "ALL":
      return Role.ALL;
    default:
      throw new Error(`Unknown role: ${input}`);
  }
}

export function roleToString(role: Role): string {
  switch (role) {
    case Role.TOP:
      return "Top";
    case Role.JUNGLE:
      return "Jungle";
    case Role.MID:
      return "Mid";
    case Role.ADC:
      return "ADC";
    case Role.SUPPORT:
      return "Support";
    case Role.ALL:
      return "Not Role Specific";
  }
}
