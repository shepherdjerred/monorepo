// Deliberate violation of storage-does-not-depend-on-the-domain-or-transports.
import "#src/league/competition/refresh.ts";

export const illegalStorageDependency = true;
