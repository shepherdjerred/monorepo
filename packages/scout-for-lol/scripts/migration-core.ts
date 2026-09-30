const requiredSecrets = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_SECRET",
  "JWT_SIGNING_SECRET",
  "RIOT_API_KEY",
] as const;

export function requireCliValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

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
