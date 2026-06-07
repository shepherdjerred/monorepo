import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { ConfigSchema, type Config } from "./schema.ts";
import { addErrorLinks, assertPathExists } from "#src/util.ts";
import { logger } from "#src/logger.ts";

export function getConfig(file = "config.toml"): Config {
  const configPath = path.resolve(file);

  assertPathExists(configPath, "config file");

  let toml: unknown;

  try {
    toml = parseToml(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error instanceof TomlError) {
      logger.error(
        `Your configuration at ${configPath} _is not_ valid TOML.\nCorrect your config to continue\nA TOML validator may be useful, such as an IDE plugin, or https://www.toml-lint.com/\n`,
      );
      throw new Error("Invalid TOML configuration", { cause: error });
    }

    throw new Error("Your configuration is invalid.", { cause: error });
  }

  const parsed = ConfigSchema.safeParse(toml);

  if (!parsed.success) {
    logger.error(
      `Your configuration at ${configPath} _is_ valid TOML, but it is not a valid configuration for this application.\nThe following problems were found:\n\n`,
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
      addErrorLinks(""),
    );
    throw new Error("Invalid configuration schema", { cause: parsed.error });
  }

  return parsed.data;
}
