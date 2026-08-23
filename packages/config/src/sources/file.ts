import { parse as parseToml } from "smol-toml";
import type {
  ConfigKeyNames,
  ConfigSource,
  SourceResult,
} from "@shepherdjerred/config/source.ts";

/**
 * Reads a dotted path out of a parsed document.
 *
 * Returns `undefined` for a missing path — absent, so resolution continues.
 * A path that exists with a `null` value is treated as absent too: TOML has no
 * null, and a JSON null is far more often "not set" than a deliberate value.
 */
function readPath(document: unknown, path: string): unknown {
  let cursor: unknown = document;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = Reflect.get(cursor, segment);
  }
  return cursor ?? undefined;
}

export type FileSourceOptions = {
  /** Absolute path to a `.toml` or `.json` file. */
  readonly path: string;
};

/**
 * Loads a config file once, up front.
 *
 * This layer exists for **apps we distribute to other people**. In our own
 * Kubernetes deployments it is normally absent: someone self-hosting one of
 * these bots has neither Flipt nor env injection, so the file is their entire
 * configuration interface.
 *
 * A missing file is absent, not an error — the common case for our own
 * deployments. A file that exists but cannot be parsed **throws**: that is a
 * broken deployment, and silently ignoring it would let a typo'd TOML look
 * exactly like no file at all.
 */
export async function createFileSource(
  options: FileSourceOptions,
): Promise<ConfigSource> {
  const handle = Bun.file(options.path);
  const document = (await handle.exists())
    ? parseDocument(await handle.text(), options.path)
    : undefined;

  return {
    name: "file",
    get: (names: ConfigKeyNames): Promise<SourceResult | undefined> => {
      if (document === undefined) {
        return Promise.resolve(undefined);
      }
      const value = readPath(document, names.file);
      return Promise.resolve(value === undefined ? undefined : { value });
    },
  };
}

function parseDocument(contents: string, path: string): unknown {
  try {
    return path.endsWith(".json") ? JSON.parse(contents) : parseToml(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse config file ${path}: ${message}`, {
      cause: error,
    });
  }
}
