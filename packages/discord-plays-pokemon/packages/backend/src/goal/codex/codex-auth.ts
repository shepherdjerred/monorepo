import path from "node:path";

export function envValue(
  values: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = values[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function buildCodexCredentialEnvironment(
  inherited: Record<string, string>,
): Record<string, string> {
  const codexAccessToken = envValue(inherited, "CODEX_ACCESS_TOKEN");
  const codexCredentialEnvironment: Record<string, string> = {};
  if (codexAccessToken !== undefined) {
    codexCredentialEnvironment["CODEX_ACCESS_TOKEN"] = codexAccessToken;
  }
  return codexCredentialEnvironment;
}

export async function hasCodexCredential(
  runtimeDirectory: string,
): Promise<boolean> {
  return (
    envValue(Bun.env, "CODEX_ACCESS_TOKEN") !== undefined ||
    (await Bun.file(codexAuthPath(runtimeDirectory)).exists())
  );
}

function codexAuthPath(runtimeDirectory: string): string {
  const codexHome = envValue(Bun.env, "CODEX_HOME");
  if (codexHome !== undefined) {
    return path.join(codexHome, "auth.json");
  }

  const home = envValue(Bun.env, "HOME");
  return home === undefined
    ? path.join(path.resolve(runtimeDirectory), ".codex", "auth.json")
    : path.join(home, ".codex", "auth.json");
}
