import path from "node:path";

export function envValue(
  values: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = values[name];
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

export function buildCodexCredentialEnvironment(
  inherited: Record<string, string>,
): Record<string, string> {
  const codexApiKey =
    envValue(inherited, "CODEX_API_KEY") ??
    envValue(inherited, "OPENAI_API_KEY");
  const codexAccessToken = envValue(inherited, "CODEX_ACCESS_TOKEN");
  const codexCredentialEnvironment: Record<string, string> = {};
  if (codexApiKey !== undefined) {
    codexCredentialEnvironment["CODEX_API_KEY"] = codexApiKey;
  }
  if (codexAccessToken !== undefined) {
    codexCredentialEnvironment["CODEX_ACCESS_TOKEN"] = codexAccessToken;
  }
  return codexCredentialEnvironment;
}

export async function hasCodexCredential(
  runtimeDirectory: string,
): Promise<boolean> {
  if (
    envValue(Bun.env, "CODEX_API_KEY") !== undefined ||
    envValue(Bun.env, "CODEX_ACCESS_TOKEN") !== undefined ||
    envValue(Bun.env, "OPENAI_API_KEY") !== undefined
  ) {
    return true;
  }

  return await Bun.file(codexAuthPath(runtimeDirectory)).exists();
}

function codexAuthPath(runtimeDirectory: string): string {
  const codexHome = envValue(Bun.env, "CODEX_HOME");
  if (codexHome !== undefined) {
    return path.join(codexHome, "auth.json");
  }

  const home = envValue(Bun.env, "HOME");
  if (home !== undefined) {
    return path.join(home, ".codex", "auth.json");
  }

  return path.join(path.resolve(runtimeDirectory), ".codex", "auth.json");
}
