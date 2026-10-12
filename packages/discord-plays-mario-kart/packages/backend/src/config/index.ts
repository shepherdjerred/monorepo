import { loadTomlConfig } from "@shepherdjerred/discord-plays-core/config/load-toml.ts";
import { ConfigSchema, type Config } from "./schema.ts";
import { addErrorLinks } from "#src/util.ts";
import { logger } from "#src/logger.ts";

export async function getConfig(file = "config.toml"): Promise<Config> {
  return loadTomlConfig({
    schema: ConfigSchema,
    file,
    logger,
    errorLinks: addErrorLinks,
  });
}
