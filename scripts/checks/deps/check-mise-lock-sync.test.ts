import { describe, expect, test } from "vitest";
import { bootstrapViolations, lockViolations } from "./check-mise-lock-sync.ts";

const artifact = { url: "https://example.test/a.tgz", checksum: "sha256:00" };

function lock(tools: Record<string, unknown[]>): unknown {
  return { lockfile_version: 3, tools };
}

describe("lockViolations", () => {
  test("accepts entries bound to each requested version on both platforms", () => {
    expect(
      lockViolations(
        {
          tools: {
            node: "24.21.0",
            "cargo:cargo-mutants": "27.1.0",
            "github:o/pg": { version: "18.6.0", bin_path: "bin" },
          },
        },
        lock({
          node: [
            {
              version: "24.21.0",
              backend: "core:node",
              specifiers: ["24.21.0"],
              "platforms.linux-x64": artifact,
              "platforms.macos-arm64": artifact,
            },
          ],
          "cargo:cargo-mutants": [
            { version: "27.1.0", backend: "cargo:cargo-mutants" },
          ],
          "github:o/pg": [
            {
              version: "18.6.0",
              backend: "github:o/pg",
              "platforms.linux-x64": artifact,
              "platforms.macos-arm64": artifact,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("reports a version bump that was not relocked", () => {
    expect(
      lockViolations(
        { tools: { gh: "2.103.0" } },
        lock({ gh: [{ version: "2.102.0", backend: "aqua:cli/cli" }] }),
      ),
    ).toEqual([
      { file: "mise.lock", message: 'gh = "2.103.0" has no lock entry' },
    ]);
  });

  test("reports an artifact missing for a runner platform", () => {
    expect(
      lockViolations(
        { tools: { jq: "1.8.2" } },
        lock({
          jq: [
            {
              version: "1.8.2",
              backend: "aqua:jqlang/jq",
              "platforms.macos-arm64": artifact,
            },
          ],
        }),
      ),
    ).toEqual([
      { file: "mise.lock", message: "jq@1.8.2 has no artifact for linux-x64" },
    ]);
  });

  test("reports entries for tools no longer configured", () => {
    expect(
      lockViolations(
        { tools: {} },
        lock({ yq: [{ version: "4.54.1", backend: "aqua:mikefarah/yq" }] }),
      ),
    ).toEqual([
      { file: "mise.lock", message: "yq is locked but no longer configured" },
    ]);
  });
});

describe("bootstrapViolations", () => {
  const dockerfile = "FROM x\nARG MISE_VERSION=v2026.10.6\n";

  test("accepts matching pins", () => {
    expect(
      bootstrapViolations(dockerfile, 'MISE_BOOTSTRAP_VERSION="v2026.10.6"\n'),
    ).toEqual([]);
  });

  test("reports drift between ci-base and the stale-image bootstrap", () => {
    expect(
      bootstrapViolations(dockerfile, 'MISE_BOOTSTRAP_VERSION="v2026.9.1"\n'),
    ).toEqual([
      {
        file: "ci/scripts/toolchain.sh",
        message:
          'MISE_BOOTSTRAP_VERSION="v2026.9.1" does not match ci/ci-image/Dockerfile\'s ARG MISE_VERSION=v2026.10.6',
      },
    ]);
  });
});
