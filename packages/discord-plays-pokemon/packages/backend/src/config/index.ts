import { ztomlSync } from "@d6v/zconf";
import { ConfigSchema } from "./schema.ts";
import { resolve } from "node:path";
import { addErrorLinks, assertPathExists } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/util.js";
import type { ZodError } from "zod";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";

export function getConfig(file?: string) {
  file = file || "config.toml";
  const path = resolve(file);

  assertPathExists(path, "config file");

  try {
    ztomlSync(ConfigSchema, path);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "SyntaxError") {
        logger.error(
          `Your configuration at ${path} _is not_ valid TOML.\nCorrect your config to continue\nA TOML validator may be useful, such as an IDE plugin, or https://www.toml-lint.com/\n`,
        );
        throw new Error();
      }
      if (error.name === "ZodError") {
        const errors = JSON.parse(error.message) as ZodError[];
        logger.error(
          `Your configuration at ${path} _is_ valid TOML, but it is not a valid configuration for this application.\nThe following problems were found:\n\n`,
          errors,
          addErrorLinks(""),
        );
        throw new Error();
      }
    } else {
      throw new Error(`Your configuration is invalid.`, { cause: error });
    }
  }
  return ztomlSync(ConfigSchema, path);
}
