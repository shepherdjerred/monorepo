import { $ } from "bun";
import { z } from "zod";
import { validatePackageName, writePackageScaffold } from "./migration-core.ts";

const RootPackageSchema = z.object({ workspaces: z.array(z.string()) }).loose();

if (import.meta.main) {
  const name = validatePackageName(Bun.argv[2]);
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const directory = `${root}/packages/${name}`;
  if (await Bun.file(`${directory}/package.json`).exists()) {
    throw new Error(`Package ${name} already exists`);
  }
  await writePackageScaffold(directory, name);
  const rootPackage = RootPackageSchema.parse(
    await Bun.file(`${root}/package.json`).json(),
  );
  rootPackage.workspaces.push(`packages/${name}`);
  rootPackage.workspaces.sort();
  await Bun.write(
    `${root}/package.json`,
    `${JSON.stringify(rootPackage, undefined, 2)}\n`,
  );
  await $`bun install --cwd ${root}`;
  console.log(`Created strict workspace package: ${name}`);
}
