import path from "node:path";

export async function resolveMise(): Promise<string> {
  const localAppData = Bun.env["LOCALAPPDATA"] ?? "";
  const candidates = [
    path.join(localAppData, "Microsoft", "WinGet", "Links", "mise.exe"),
    path.join(localAppData, "mise", "bin", "mise.exe"),
  ];
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }
  }

  const executable = Bun.which("mise");
  if (executable !== null) {
    return executable;
  }
  throw new Error(
    "mise is missing. Install it from https://mise.jdx.dev/getting-started.html and reopen the terminal.",
  );
}
