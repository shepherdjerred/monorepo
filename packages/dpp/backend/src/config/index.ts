import { ztomlSync } from "@d6v/zconf";
import { ConfigSchema } from "./schema.js";
import { resolve } from "path";
import { addErrorLinks, assertPathExists } from "../util.js";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export function getConfig(file?: string) {
  file = file || "config.toml";
  const path = resolve(file);

  assertPathExists(path, "config file");

  try {
    ztomlSync(ConfigSchema, path);
  } catch (e) {
    if (e instanceof Error) {
      if (e.name === "SyntaxError") {
        logger.error(
          `Your configuration at ${path} _is not_ valid TOML.\nCorrect your config to continue\nA TOML validator may be useful, such as an IDE plugin, or https://www.toml-lint.com/\n`,
        );
        throw Error();
      }
      if (e.name === "ZodError") {
        const errors = JSON.parse(e.message) as ZodError[];
        logger.error(
          `Your configuration at ${path} _is_ valid TOML, but it is not a valid configuration for this application.\nThe following problems were found:\n\n`,
          errors,
          addErrorLinks(""),
        );
        throw Error();
      }
    } else {
      throw new Error(`Your configuration is invalid.`, { cause: e });
    }
  }
  return ztomlSync(ConfigSchema, path);
}
