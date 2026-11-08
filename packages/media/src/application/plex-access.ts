export type PlexServerAccess = {
  accountId: string;
  serverMachineId: string;
  serverToken: string;
  permittedSectionIds: string[];
  permittedMediaKinds: ("movie" | "series")[];
  plexRestricted: boolean;
};

export type PlexPermissionSnapshot = Omit<PlexServerAccess, "serverToken">;
