/** Renderers receive only OS bootstrap variables, never the bot's credentials. */
export function runtimeEnvironment(): Record<string, string> {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LD_LIBRARY_PATH",
    "LIBGL_DRIVERS_PATH",
    "XDG_RUNTIME_DIR",
  ];
  const environment: Record<string, string> = {};
  for (const name of names) {
    const value = Bun.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
