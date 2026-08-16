export function installPaths(home: string): {
  readonly binary: string;
  readonly legacyBinary: string;
} {
  return {
    binary: `${home}/.local/bin/toolkit`,
    legacyBinary: `${home}/.local/bin/tools`,
  };
}
