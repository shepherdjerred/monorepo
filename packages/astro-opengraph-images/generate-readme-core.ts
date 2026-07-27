export function sortedPresetNames(paths: readonly string[]): string[] {
  return paths.map((path) => path.split("/").at(-1) ?? path).sort();
}
