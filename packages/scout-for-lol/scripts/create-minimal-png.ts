import { minimalPng } from "./migration-core.ts";

if (import.meta.main) {
  const iconDirectory = `${import.meta.dir}/packages/desktop/src-tauri/icons`;
  const png = minimalPng();
  await Promise.all(
    ["32x32.png", "128x128.png", "128x128@2x.png"].map((name) =>
      Bun.write(`${iconDirectory}/${name}`, png),
    ),
  );
}
