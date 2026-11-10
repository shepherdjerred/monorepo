#!/usr/bin/env bun
/**
 * Generates TypeScript provider bindings into `generated/` from the provider
 * versions pinned in `cdktf.json`.
 *
 * `cdktn get` asks OpenTofu for each provider's schema, so it needs `tofu`
 * and registry access. The CLI itself runs under Node: under Bun its Node
 * version preflight fails ("Node.js version could not be determined").
 * Synthesis never needs the CLI or Node; see `synth.ts`.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

await rm(path.join(root, "generated"), { recursive: true, force: true });
const child = Bun.spawn(
  ["node", "node_modules/cdktn-cli/bin/cdktn", "get", "--force"],
  {
    cwd: root,
    env: {
      ...Bun.env,
      TERRAFORM_BINARY_NAME: "tofu",
      CHECKPOINT_DISABLE: "1",
      CI: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await child.exited;
if (exitCode !== 0) {
  throw new Error(`cdktn get failed (exit ${exitCode.toString()})`);
}

// The generator does not emit `override` modifiers, which this repository's
// `noImplicitOverride` requires (TS4114 on every binding). The bindings are
// third-party output, so they are exempted from checking instead of loosening
// the compiler options for the stacks that import them; their types still
// flow to those stacks.
const NO_CHECK = "// @ts-nocheck\n";
let count = 0;
for await (const file of new Bun.Glob("**/*.ts").scan({
  cwd: path.join(root, "generated"),
  absolute: true,
})) {
  const content = await Bun.file(file).text();
  if (!content.startsWith(NO_CHECK)) await Bun.write(file, NO_CHECK + content);
  count += 1;
}
if (count === 0) throw new Error("cdktn get generated no bindings");
console.log(`generated ${count.toString()} binding files`);
