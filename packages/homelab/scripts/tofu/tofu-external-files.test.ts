import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import { lintTargets } from "./lint-tofu.ts";
import {
  TOFU_STACK_ROOT,
  fileReferences,
  stackConfigurationFormat,
  stackFileReferences,
  verifyStackExternalFiles,
  verifyTofuExternalFiles,
} from "./tofu-external-files.ts";

const repository = path.resolve(import.meta.dir, "../../../..");
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

/** A throwaway repository with one stack that reads a shared file and a module template. */
async function fixture(main: string, options: { shared?: boolean } = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tofu-external-files-"));
  scratch.push(repoRoot);
  const stackDirectory = path.join(repoRoot, TOFU_STACK_ROOT, "cloudflare");
  await mkdir(path.join(stackDirectory, "modules/static-cache"), {
    recursive: true,
  });
  await mkdir(path.join(stackDirectory, "tests"), { recursive: true });
  await Bun.write(path.join(stackDirectory, "main.tf"), main);
  await Bun.write(path.join(stackDirectory, "local.json"), "{}\n");
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/main.tf"),
    'locals {\n  template = templatefile("${path.module}/rule.tftpl", {})\n}\n',
  );
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/rule.tftpl"),
    "rule\n",
  );
  await Bun.write(
    path.join(stackDirectory, "tests/ignored.tf"),
    'locals {\n  ignored = file("${path.module}/../../../../../../nowhere.json")\n}\n',
  );
  if (options.shared !== false)
    await Bun.write(
      path.join(repoRoot, "packages/homelab/src/domain-registry.json"),
      "{}\n",
    );
  return { repoRoot, stackDirectory };
}
const readsRegistry =
  'locals {\n  registry = jsondecode(file("${path.module}/../../domain-registry.json"))\n  local    = jsondecode(file("local.json"))\n}\n';

describe("stack external file declarations", () => {
  test("the live manifest declares exactly the files every stack reads outside its directory", async () => {
    await expect(verifyTofuExternalFiles(repository)).resolves.toBeUndefined();
    const cloudflare = await stackFileReferences({
      repoRoot: repository,
      stackDirectory: path.join(repository, TOFU_STACK_ROOT, "cloudflare"),
    });
    // The synthesized cloudflare stack carries the domain registry and the
    // platform model inline, and posthog the analytics registry: neither
    // reads a file at plan time.
    expect(cloudflare).toEqual([]);
    expect(STACK_MANIFEST.cloudflare.externalFiles).toEqual([]);
    expect(STACK_MANIFEST.posthog.externalFiles).toEqual([]);
  });

  test("resolves module-relative, root-relative and bare paths against the right directory", async () => {
    const { repoRoot, stackDirectory } = await fixture(readsRegistry);
    const references = await verifyStackExternalFiles({
      repoRoot,
      stackDirectory,
      declared: ["packages/homelab/src/domain-registry.json"],
    });
    expect(references.map((reference) => reference.target).sort()).toEqual([
      "packages/homelab/src/domain-registry.json",
      `${TOFU_STACK_ROOT}/cloudflare/local.json`,
      `${TOFU_STACK_ROOT}/cloudflare/modules/static-cache/rule.tftpl`,
    ]);
  });

  test("an undeclared escaping reference fails loudly", async () => {
    const { repoRoot, stackDirectory } = await fixture(readsRegistry);
    await expect(
      verifyStackExternalFiles({ repoRoot, stackDirectory, declared: [] }),
    ).rejects.toThrow(/undeclared external files[\s\S]*domain-registry\.json/u);
  });

  test("a declared file must exist and must actually be read", async () => {
    const missing = await fixture(readsRegistry, { shared: false });
    await expect(
      verifyStackExternalFiles({
        ...missing,
        declared: ["packages/homelab/src/domain-registry.json"],
      }),
    ).rejects.toThrow("not a regular file");
    const unread = await fixture('locals {\n  local = file("local.json")\n}\n');
    await expect(
      verifyStackExternalFiles({
        ...unread,
        declared: ["packages/homelab/src/domain-registry.json"],
      }),
    ).rejects.toThrow("does not read");
  });

  test("references that cannot be resolved statically are rejected rather than skipped", () => {
    const input = {
      repoRoot: "/repo",
      stackDirectory: `/repo/${TOFU_STACK_ROOT}/cloudflare`,
      file: `/repo/${TOFU_STACK_ROOT}/cloudflare/main.tf`,
    };
    expect(() =>
      fileReferences({ ...input, content: "x = file(var.registry)" }),
    ).toThrow("without a literal path");
    expect(() =>
      fileReferences({
        ...input,
        content: 'x = file("${path.module}/${var.name}")',
      }),
    ).toThrow("not a literal path");
    expect(() =>
      fileReferences({ ...input, content: 'x = file("${var.dir}/a.json")' }),
    ).toThrow("not a literal path");
    expect(() =>
      fileReferences({ ...input, content: 'x = file("${path.cwd}/a.json")' }),
    ).toThrow("path.cwd");
    expect(() =>
      fileReferences({
        ...input,
        content: 'x = file("${path.module}/../../../../../../../etc/passwd")',
      }),
    ).toThrow("outside the repository");
    expect(
      fileReferences({
        ...input,
        content:
          '# x = file("${path.module}/../commented.json")\ny = filemd5("${path.root}/public/index.html")',
      }),
    ).toEqual([
      {
        source: `${TOFU_STACK_ROOT}/cloudflare/main.tf`,
        expression: "${path.root}/public/index.html",
        target: `${TOFU_STACK_ROOT}/cloudflare/public/index.html`,
      },
    ]);
  });
});

describe("synthesized (JSON) configuration", () => {
  const input = {
    repoRoot: "/repo",
    stackDirectory: `/repo/${TOFU_STACK_ROOT}/cloudflare`,
    file: `/repo/${TOFU_STACK_ROOT}/cloudflare/main.tf.json`,
  };

  test("finds the file calls JSON syntax escapes inside its string values", () => {
    const content = JSON.stringify({
      locals: {
        registry:
          '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
      },
      resource: {
        aws_s3_object: {
          index: [{ source_hash: '${filemd5("public/index.html")}' }],
        },
      },
    });
    expect(
      fileReferences({ ...input, content })
        .map((reference) => reference.target)
        .sort(),
    ).toEqual([
      "packages/homelab/src/domain-registry.json",
      `${TOFU_STACK_ROOT}/cloudflare/public/index.html`,
    ]);
  });

  test("rejects a non-literal read the same way HCL does", () => {
    expect(() =>
      fileReferences({
        ...input,
        content: JSON.stringify({ locals: { x: "${file(var.registry)}" } }),
      }),
    ).toThrow("without a literal path");
  });

  test("a synthesized root and its local HCL module are both searched", async () => {
    const { repoRoot, stackDirectory } = await fixture("");
    await rm(path.join(stackDirectory, "main.tf"));
    await Bun.write(
      path.join(stackDirectory, "main.tf.json"),
      JSON.stringify({
        locals: {
          registry:
            '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
        },
      }),
    );
    const references = await verifyStackExternalFiles({
      repoRoot,
      stackDirectory,
      declared: ["packages/homelab/src/domain-registry.json"],
    });
    expect(references.map((reference) => reference.target).sort()).toEqual([
      "packages/homelab/src/domain-registry.json",
      `${TOFU_STACK_ROOT}/cloudflare/modules/static-cache/rule.tftpl`,
    ]);
  });
});

describe("tflint targets", () => {
  test("lints every HCL directory and leaves a synthesized-only stack to its own checks", async () => {
    const { repoRoot, stackDirectory } = await fixture("");
    const tofuRoot = path.dirname(stackDirectory);
    await mkdir(path.join(tofuRoot, "github"), { recursive: true });
    await Bun.write(path.join(tofuRoot, "github/main.tf.json"), "{}\n");
    // A synthesized root that still calls a local HCL module.
    await mkdir(path.join(tofuRoot, "mixed/modules/x"), { recursive: true });
    await Bun.write(path.join(tofuRoot, "mixed/main.tf.json"), "{}\n");
    await Bun.write(path.join(tofuRoot, "mixed/modules/x/main.tf"), "\n");
    const relative = (directories: string[]) =>
      directories.map((directory) => path.relative(tofuRoot, directory));
    const targets = lintTargets(tofuRoot);
    expect(relative(targets.hcl)).toEqual([
      "cloudflare",
      "cloudflare/modules/static-cache",
      "cloudflare/tests",
      "mixed/modules/x",
    ]);
    expect(relative(targets.synthesizedOnly)).toEqual(["github", "mixed"]);
    expect(repoRoot).not.toBe("");
  });

  test("every live stack is synthesized, leaving no HCL to lint", () => {
    const targets = lintTargets(path.join(repository, TOFU_STACK_ROOT));
    expect(targets.hcl).toEqual([]);
    expect(
      targets.synthesizedOnly.map((directory) => path.basename(directory)),
    ).toContain("github");
  });
});

describe("stack configuration format", () => {
  test("every stack is hand-written HCL or a cdktn synthesis, never both", async () => {
    const synthesized: string[] = [];
    for (const stack of TofuStackSchema.options) {
      const format = await stackConfigurationFormat(
        stack,
        path.join(repository, TOFU_STACK_ROOT, stack),
      );
      if (format === "synthesized") synthesized.push(stack);
    }
    // Which stacks are synthesized is asserted where the list lives, in
    // packages/homelab-cdktn/src/synth.test.ts.
    expect(synthesized).toContain("github");
  });

  test("rejects a stack directory that mixes or lacks configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tofu-format-"));
    scratch.push(directory);
    await expect(stackConfigurationFormat("github", directory)).rejects.toThrow(
      "neither providers.tf nor a synthesized main.tf.json",
    );
    await Bun.write(path.join(directory, "main.tf.json"), "{}\n");
    expect(await stackConfigurationFormat("github", directory)).toBe(
      "synthesized",
    );
    await Bun.write(path.join(directory, "providers.tf"), "");
    await expect(stackConfigurationFormat("github", directory)).rejects.toThrow(
      "both a synthesized main.tf.json and HCL files",
    );
    await rm(path.join(directory, "main.tf.json"));
    expect(await stackConfigurationFormat("github", directory)).toBe("hcl");
  });
});
