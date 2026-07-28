const requiredSecrets = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_SECRET",
  "JWT_SIGNING_SECRET",
  "RIOT_API_KEY",
] as const;

const pngBytes = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  218, 99, 100, 248, 207, 80, 15, 0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
] as const;

export function unresolvedSecrets(
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  return requiredSecrets.filter((name) => {
    const value = environment[name];
    return (
      value === undefined || value.length === 0 || value.startsWith("op://")
    );
  });
}

export async function filesEqual(
  left: string,
  right: string,
): Promise<boolean> {
  if (!(await Bun.file(right).exists())) return false;
  const leftBytes = await Bun.file(left).bytes();
  const rightBytes = await Bun.file(right).bytes();
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.every((byte, index) => rightBytes[index] === byte)
  );
}

export function scoutIconDirectory(scriptDirectory: string): string {
  const suffix = "/scripts";
  if (!scriptDirectory.endsWith(suffix)) {
    throw new Error(
      `Expected Scout scripts directory, received ${scriptDirectory}`,
    );
  }
  const packageRoot = scriptDirectory.slice(0, -suffix.length);
  return `${packageRoot}/packages/desktop/src-tauri/icons`;
}

export function minimalPng(): Uint8Array {
  return new Uint8Array(pngBytes);
}
