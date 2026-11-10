#!/usr/bin/env bun
/**
 * Generates TypeScript provider bindings into `generated/` for every provider
 * `packages/homelab/src/tofu/provider-versions.json` marks `"bindings": true`,
 * at exactly the version pinned there.
 *
 * `cdktn get` asks OpenTofu for each provider's schema, so it needs `tofu`
 * and registry access. The CLI itself runs under Node: under Bun its Node
 * version preflight fails ("Node.js version could not be determined").
 * Synthesis never needs the CLI or Node; see `synth.ts`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareAsuswrtProvider } from "homelab/scripts/tofu/asuswrt-provider.ts";
import {
  loadProviderPins,
  providerAddress,
} from "homelab/scripts/tofu/provider-versions.ts";
import type { ProviderPin } from "homelab/scripts/tofu/provider-versions.ts";
import { OPENTOFU_TARGET_VERSION } from "#src/homelab-stack.ts";

const root = path.resolve(import.meta.dir, "..");
const generated = path.join(root, "generated");

const DEFAULT_REGISTRY = "registry.opentofu.org";

/**
 * One `terraformProviders` entry of the `cdktf.json` handed to `cdktn get`.
 * The source becomes the stack's `required_providers` source verbatim, so a
 * provider from OpenTofu's default registry keeps the bare `namespace/type`
 * the stacks have always declared, and only another registry is spelled out.
 */
export function bindingSpecification(pin: ProviderPin): {
  name: string;
  source: string;
  version: string;
} {
  const type = pin.source.split("/").at(-1) ?? pin.source;
  return {
    name: pin.bindingsName ?? type,
    source:
      new URL(pin.registryUrl).host === DEFAULT_REGISTRY
        ? pin.source
        : providerAddress(pin),
    version: pin.version,
  };
}

async function generate(): Promise<void> {
  const allPins = await loadProviderPins();
  const pins = allPins.filter((pin) => pin.bindings === true);
  if (pins.length === 0) throw new Error("no provider has bindings enabled");
  const workdir = await mkdtemp(path.join(tmpdir(), "cdktn-get-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(Bun.env).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, value]],
      ),
    ),
    TERRAFORM_BINARY_NAME: "tofu",
    CHECKPOINT_DISABLE: "1",
    CI: "1",
  };
  let localProviderRoot: string | undefined;
  try {
    if (pins.some((pin) => pin.local === true)) {
      // The repository-owned provider is served from a filesystem mirror.
      localProviderRoot = await prepareAsuswrtProvider(env);
    }
    await Bun.write(
      path.join(workdir, "cdktf.json"),
      JSON.stringify({
        language: "typescript",
        app: "true",
        codeMakerOutput: generated,
        sendCrashReports: "false",
        sendUsageTelemetry: "false",
        targetVersions: { opentofu: OPENTOFU_TARGET_VERSION },
        terraformProviders: pins.map((pin) => bindingSpecification(pin)),
        terraformModules: [],
      }),
    );
    await rm(generated, { recursive: true, force: true });
    const child = Bun.spawn(
      [
        "node",
        path.join(root, "node_modules/cdktn-cli/bin/cdktn"),
        "get",
        "--force",
      ],
      { cwd: workdir, env, stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`cdktn get failed (exit ${exitCode.toString()})`);
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
    if (localProviderRoot !== undefined)
      await rm(localProviderRoot, { recursive: true, force: true });
  }

  // The generator does not emit `override` modifiers, which this repository's
  // `noImplicitOverride` requires (TS4114 on every binding). The bindings are
  // third-party output, so they are exempted from checking instead of loosening
  // the compiler options for the stacks that import them; their types still
  // flow to those stacks.
  const NO_CHECK = "// @ts-nocheck\n";
  let count = 0;
  for await (const file of new Bun.Glob("**/*.ts").scan({
    cwd: generated,
    absolute: true,
  })) {
    const content = await Bun.file(file).text();
    if (!content.startsWith(NO_CHECK))
      await Bun.write(file, NO_CHECK + content);
    count += 1;
  }
  if (count === 0) throw new Error("cdktn get generated no bindings");
  console.log(
    `generated ${count.toString()} binding files for ${pins.map((pin) => pin.source).join(", ")}`,
  );
}

if (import.meta.main) await generate();
