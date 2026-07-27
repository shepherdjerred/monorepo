import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { sortedPresetNames } from "./generate-readme-core.ts";

if (import.meta.main) {
  const root = import.meta.dir;
  const assets = `${root}/assets/presets`;
  await rm(assets, { force: true, recursive: true });
  await mkdir(assets, { recursive: true });
  await $`bun run ${root}/src/presets/renderExamples.ts`;
  const presets = sortedPresetNames([
    ...new Bun.Glob("*").scanSync({ cwd: assets, onlyFiles: true }),
  ]);
  const rendered =
    await $`gomplate -f ${root}/README.md.tmpl -d ${`presets=env:///PRESETS?type=application/json`}`
      .env({ ...Bun.env, PRESETS: JSON.stringify(presets) })
      .text();
  await Bun.write(`${root}/README.md`, rendered);
}
