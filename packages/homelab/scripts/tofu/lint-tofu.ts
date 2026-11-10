// Lints every OpenTofu stack under src/tofu.
// Before anything else, every stack's reads outside its own directory are
// checked against the manifest's `externalFiles`, because the stack archive
// Delivery runs from contains exactly the stack directory plus those
// declarations. That check reads HCL and synthesized JSON alike.
// Hand-written HCL is then linted with tflint's bundled terraform ruleset
// through a repository-owned empty config (no plugins, no `tflint --init`, no
// network). The explicit config prevents an ambient ~/.tflint.hcl from
// changing local lint behavior. A synthesized `main.tf.json` is generated
// output: its source is typechecked and linted in packages/homelab-cdktn, the
// committed file is compared with a fresh synthesis there, and `tofu validate`
// covers the result, so tflint has nothing left to say about it.
// Directories are discovered, not hardcoded, so a new stack is linted the day
// it appears; zero discovered directories means the discovery broke, not that
// there is nothing to lint.
import { $ } from "bun";
import path from "node:path";
import { verifyTofuExternalFiles } from "./tofu-external-files.ts";

/** Directories holding configuration, split by whether tflint has HCL to read there. */
export function lintTargets(tofuRoot: string): {
  hcl: string[];
  synthesizedOnly: string[];
} {
  const hcl = new Set<string>();
  const synthesized = new Set<string>();
  for (const file of new Bun.Glob("**/*.{tf,tf.json}").scanSync({
    cwd: tofuRoot,
    onlyFiles: true,
  })) {
    const directory = path.join(tofuRoot, path.dirname(file));
    (file.endsWith(".tf") ? hcl : synthesized).add(directory);
  }
  return {
    hcl: [...hcl].sort(),
    synthesizedOnly: [...synthesized]
      .filter((directory) => !hcl.has(directory))
      .sort(),
  };
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "../..");
  const tofuRoot = `${root}/src/tofu`;
  const config = `${root}/.tflint.hcl`;
  await verifyTofuExternalFiles(path.resolve(root, "../.."));
  console.log("external file declarations match every stack");
  const { hcl, synthesizedOnly } = lintTargets(tofuRoot);
  if (hcl.length === 0 && synthesizedOnly.length === 0) {
    throw new Error(`no OpenTofu configuration found under ${tofuRoot}`);
  }
  for (const directory of synthesizedOnly) {
    console.log(
      `synthesized ${path.relative(root, directory)} (checked in packages/homelab-cdktn)`,
    );
  }
  for (const directory of hcl) {
    console.log(`tflint ${path.relative(root, directory)}`);
    await $`tflint --config ${config} --chdir ${directory}`;
  }
}
