import { ztomlSync } from "@d6v/zconf";
import { ConfigSchema } from "./schema.ts";
import path from "node:path";
import { addErrorLinks, assertPathExists } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/util.js";
import type { ZodError } from "zod";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";

export function getConfig(file = "config.toml") {
  const configPath = path.resolve(file);

  assertPathExists(configPath, "config file");

  try {
    ztomlSync(ConfigSchema, configPath);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "SyntaxError") {
        logger.error(
          `Your configuration at ${configPath} _is not_ valid TOML.\nCorrect your config to continue\nA TOML validator may be useful, such as an IDE plugin, or https://www.toml-lint.com/\n`,
        );
        throw new Error("Invalid TOML configuration");
      }
      if (error.name === "ZodError") {
        const errors = JSON.parse(error.message) as ZodError[];
        logger.error(
          `Your configuration at ${configPath} _is_ valid TOML, but it is not a valid configuration for this application.\nThe following problems were found:\n\n`,
          errors,
          addErrorLinks(""),
        );
        throw new Error("Invalid configuration schema");
      }
    } else {
      throw new Error(`Your configuration is invalid.`, { cause: error });
    }
  }
  return ztomlSync(ConfigSchema, configPath);
}
