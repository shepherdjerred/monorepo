import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import {
  TOFU_STACK_ROOT,
  assertSynthesizedStack,
  fileReferences,
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

/** A synthesized configuration whose locals are the given expressions. */
function configuration(locals: Readonly<Record<string, string>>): string {
  return JSON.stringify({ locals });
}

/** A throwaway repository with one stack that reads a shared file and a module template. */
async function fixture(
  locals: Readonly<Record<string, string>>,
  options: { shared?: boolean } = {},
) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tofu-external-files-"));
  scratch.push(repoRoot);
  const stackDirectory = path.join(repoRoot, TOFU_STACK_ROOT, "cloudflare");
  await mkdir(path.join(stackDirectory, "modules/static-cache"), {
    recursive: true,
  });
  await mkdir(path.join(stackDirectory, "tests"), { recursive: true });
  await Bun.write(
    path.join(stackDirectory, "main.tf.json"),
    configuration(locals),
  );
  await Bun.write(path.join(stackDirectory, "local.json"), "{}\n");
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/main.tf.json"),
    configuration({
      template: '${templatefile("${path.module}/rule.tftpl", {})}',
    }),
  );
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/rule.tftpl"),
    "rule\n",
  );
  await Bun.write(
    path.join(stackDirectory, "tests/ignored.tf.json"),
    configuration({
      ignored: '${file("${path.module}/../../../../../../nowhere.json")}',
    }),
  );
  if (options.shared !== false)
    await Bun.write(
      path.join(repoRoot, "packages/homelab/src/domain-registry.json"),
      "{}\n",
    );
  return { repoRoot, stackDirectory };
}
const readsRegistry = {
  registry: '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
  local: '${jsondecode(file("local.json"))}',
};

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
    const unread = await fixture({ local: '${file("local.json")}' });
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
      file: `/repo/${TOFU_STACK_ROOT}/cloudflare/main.tf.json`,
    };
    const references = (expression: string) =>
      fileReferences({ ...input, content: configuration({ x: expression }) });
    expect(() => references("${file(var.registry)}")).toThrow(
      "without a literal path",
    );
    expect(() => references('${file("${path.module}/${var.name}")}')).toThrow(
      "not a literal path",
    );
    expect(() => references('${file("${var.dir}/a.json")}')).toThrow(
      "not a literal path",
    );
    expect(() => references('${file("${path.cwd}/a.json")}')).toThrow(
      "path.cwd",
    );
    expect(() =>
      references('${file("${path.module}/../../../../../../../etc/passwd")}'),
    ).toThrow("outside the repository");
    expect(references('${filemd5("${path.root}/public/index.html")}')).toEqual([
      {
        source: `${TOFU_STACK_ROOT}/cloudflare/main.tf.json`,
        expression: "${path.root}/public/index.html",
        target: `${TOFU_STACK_ROOT}/cloudflare/public/index.html`,
      },
    ]);
  });

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
      fileReferences({
        repoRoot: "/repo",
        stackDirectory: `/repo/${TOFU_STACK_ROOT}/cloudflare`,
        file: `/repo/${TOFU_STACK_ROOT}/cloudflare/main.tf.json`,
        content,
      })
        .map((reference) => reference.target)
        .sort(),
    ).toEqual([
      "packages/homelab/src/domain-registry.json",
      `${TOFU_STACK_ROOT}/cloudflare/public/index.html`,
    ]);
  });
});

describe("synthesized stacks", () => {
  test("every live stack is a committed synthesis holding no HCL", async () => {
    // Which stacks the app synthesizes is asserted where the list lives, in
    // packages/homelab-cdktn/src/synth.test.ts.
    for (const stack of TofuStackSchema.options)
      await expect(
        assertSynthesizedStack(
          stack,
          path.join(repository, TOFU_STACK_ROOT, stack),
        ),
      ).resolves.toBeUndefined();
  });

  test("rejects a stack directory without a synthesis, or holding HCL anywhere", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tofu-format-"));
    scratch.push(directory);
    await Bun.write(path.join(directory, "providers.tf"), "");
    await expect(assertSynthesizedStack("github", directory)).rejects.toThrow(
      "Stack github has no synthesized main.tf.json",
    );
    await Bun.write(path.join(directory, "main.tf.json"), "{}\n");
    await expect(assertSynthesizedStack("github", directory)).rejects.toThrow(
      "holds HCL next to its synthesized main.tf.json: providers.tf",
    );
    await rm(path.join(directory, "providers.tf"));
    await expect(
      assertSynthesizedStack("github", directory),
    ).resolves.toBeUndefined();
    // A local HCL module would be configuration nothing lints or reads.
    await Bun.write(path.join(directory, "modules/x/main.tf"), "\n");
    await expect(assertSynthesizedStack("github", directory)).rejects.toThrow(
      "holds HCL next to its synthesized main.tf.json: modules/x/main.tf",
    );
    await rm(path.join(directory, "modules"), { recursive: true });
    // Modules OpenTofu downloaded into its data directory are not the stack's.
    await Bun.write(path.join(directory, ".terraform/modules/x/main.tf"), "\n");
    await expect(
      assertSynthesizedStack("github", directory),
    ).resolves.toBeUndefined();
  });

  test("the external-file check refuses a stack holding HCL", async () => {
    const { repoRoot, stackDirectory } = await fixture(readsRegistry);
    await Bun.write(
      path.join(stackDirectory, "extra.tf"),
      'locals {\n  x = file("${path.module}/../../undeclared.json")\n}\n',
    );
    await expect(
      verifyStackExternalFiles({
        repoRoot,
        stackDirectory,
        declared: ["packages/homelab/src/domain-registry.json"],
      }),
    ).rejects.toThrow("holds HCL next to its synthesized main.tf.json");
  });
});
