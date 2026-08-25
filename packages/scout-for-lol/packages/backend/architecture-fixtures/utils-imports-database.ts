// Deliberate violation of utils-does-not-depend-on-the-application.
import "#src/database/index.ts";

export const illegalUtilsDependency = true;
