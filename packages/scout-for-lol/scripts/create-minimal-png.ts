import { minimalPng, scoutIconDirectory } from "./migration-core.ts";

if (import.meta.main) {
  const iconDirectory = scoutIconDirectory(import.meta.dir);
  const png = minimalPng();
  await Promise.all(
    ["32x32.png", "128x128.png", "128x128@2x.png"].map((name) =>
      Bun.write(`${iconDirectory}/${name}`, png),
    ),
  );
}
