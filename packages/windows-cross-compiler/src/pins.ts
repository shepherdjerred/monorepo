import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");

/** Default values of the Dockerfile's `ARG NAME=value` declarations. */
export function dockerfileArgs(
  dockerfile: string,
): ReadonlyMap<string, string> {
  const args = new Map<string, string>();
  for (const match of dockerfile.matchAll(/^ARG ([A-Z0-9_]+)=(\S+)$/gmu)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) {
      continue;
    }
    if (args.has(name)) {
      throw new Error(`Dockerfile declares ARG ${name} more than once.`);
    }
    args.set(name, value);
  }
  return args;
}

/** The `tool = "version"` pin for a tool in a mise TOML file. */
export function misePin(miseToml: string, tool: string): string {
  const pattern = new RegExp(`^${tool} = "([^"]+)"$`, "mu");
  const version = pattern.exec(miseToml)?.[1];
  if (version === undefined) {
    throw new Error(`mise configuration has no ${tool} pin.`);
  }
  return version;
}

/** The .NET SDK version a global.json pins. */
export function globalJsonSdkVersion(globalJson: string): string {
  const parsed: unknown = JSON.parse(globalJson);
  if (typeof parsed !== "object" || parsed === null || !("sdk" in parsed)) {
    throw new Error("global.json has no sdk section.");
  }
  const { sdk } = parsed;
  if (typeof sdk !== "object" || sdk === null || !("version" in sdk)) {
    throw new Error("global.json has no sdk.version.");
  }
  const { version } = sdk;
  if (typeof version !== "string") {
    throw new TypeError("global.json sdk.version is not a string.");
  }
  return version;
}

export async function readRepositoryFile(
  relativePath: string,
): Promise<string> {
  return await Bun.file(path.join(repositoryRoot, relativePath)).text();
}

export async function readPackageFile(relativePath: string): Promise<string> {
  return await Bun.file(path.join(packageRoot, relativePath)).text();
}
