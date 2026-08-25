// Deliberate violation of database-does-not-depend-on-transports-or-the-domain.
import "#src/discord/client.ts";

export const illegalDatabaseDependency = true;
