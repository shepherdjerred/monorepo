import path from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import type { z } from "zod";
import type { Logger } from "#src/logger.ts";

export type LoadTomlConfigOptions<TConfig> = {
  readonly schema: z.ZodType<TConfig>;
  /** Resolved against the working directory. */
  readonly file: string;
  readonly logger: Logger;
  /** Appended to validation errors so operators can find the setup guide. */
  readonly errorLinks: (message: string) => string;
};

/**
 * Read and validate a game's `config.toml`. Problems are logged in an
 * operator-friendly form and then thrown: a bot must never boot on a partial
 * or misspelled configuration.
 */
export async function loadTomlConfig<TConfig>({
  schema,
  file,
  logger,
  errorLinks,
}: LoadTomlConfigOptions<TConfig>): Promise<TConfig> {
  const configPath = path.resolve(file);
  const configFile = Bun.file(configPath);

  if (configFile.size === 0) {
    logger.error(
      errorLinks(
        `The config file do not exist at expected path, which is ${configPath}`,
      ),
    );
    throw new Error(`${configPath} does not exist`);
  }

  const text = await configFile.text();
  let toml: unknown;

  try {
    toml = parseToml(text);
  } catch (error) {
    if (error instanceof TomlError) {
      logger.error(
        `Your configuration at ${configPath} _is not_ valid TOML.\nCorrect your config to continue\nA TOML validator may be useful, such as an IDE plugin, or https://www.toml-lint.com/\n`,
      );
      throw new Error("Invalid TOML configuration", { cause: error });
    }

    throw new Error("Your configuration is invalid.", { cause: error });
  }

  const parsed = schema.safeParse(toml);

  if (!parsed.success) {
    logger.error(
      `Your configuration at ${configPath} _is_ valid TOML, but it is not a valid configuration for this application.\nThe following problems were found:\n\n`,
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
      errorLinks(""),
    );
    throw new Error("Invalid configuration schema", { cause: parsed.error });
  }

  return parsed.data;
}
