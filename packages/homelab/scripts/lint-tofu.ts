// Lints every OpenTofu stack under src/tofu with tflint's bundled terraform
// ruleset through a repository-owned empty config (no plugins, no `tflint
// --init`, no network). The explicit config prevents an ambient
// ~/.tflint.hcl from changing local lint behavior.
// Directories are discovered, not hardcoded, so a new stack is linted the day
// it appears; zero discovered directories means the discovery broke, not that
// there is nothing to lint.
import { $ } from "bun";
import path from "node:path";

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const tofuRoot = `${root}/src/tofu`;
  const config = `${root}/.tflint.hcl`;
  const directories = new Set<string>();
  for (const file of new Bun.Glob("**/*.tf").scanSync({
    cwd: tofuRoot,
    onlyFiles: true,
  })) {
    directories.add(path.join(tofuRoot, path.dirname(file)));
  }
  if (directories.size === 0) {
    throw new Error(`no .tf files found under ${tofuRoot}`);
  }
  for (const directory of [...directories].sort()) {
    console.log(`tflint ${path.relative(root, directory)}`);
    await $`tflint --config ${config} --chdir ${directory}`;
  }
}
