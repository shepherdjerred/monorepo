// Deliberate violation of analytics-reads-the-database-and-nothing-else.
import "#src/league/competition/refresh.ts";

export const illegalAnalyticsDependency = true;
