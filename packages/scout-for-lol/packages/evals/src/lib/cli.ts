export function argumentValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
}
