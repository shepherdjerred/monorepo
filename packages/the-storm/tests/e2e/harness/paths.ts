import path from "node:path";

/** Package root, for reaching the built jar and the owned server configs. */
export const packageRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** The built TheStorm.jar under test. */
export const stormJar = path.join(
  packageRoot,
  "plugin",
  "dist",
  "build",
  "libs",
  "TheStorm.jar",
);

/** The owned TheStorm plugin configs staged onto the test server. */
export const ownedConfigDir = path.join(
  packageRoot,
  "server",
  "owned",
  "plugins",
  "TheStorm",
);

export const ownedConfig = path.join(ownedConfigDir, "config.yml");
