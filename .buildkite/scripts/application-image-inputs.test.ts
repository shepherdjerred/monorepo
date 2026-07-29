import { describe, expect, test } from "bun:test";

const repoRoot = new URL("../..", import.meta.url).pathname;

async function read(path: string): Promise<string> {
  return Bun.file(`${repoRoot}/${path}`).text();
}

describe("application image inputs", () => {
  test("publishes immutable candidate tags without mutable latest aliases", async () => {
    const bake = await read("docker-bake.hcl");
    expect(bake).toContain('"${REGISTRY}/${name}:candidate-${GIT_SHA}"');
    expect(bake).not.toContain('"${REGISTRY}/${name}:latest"');
  });

  test("pins and verifies yt-dlp release assets for both architectures", async () => {
    const versions: string[] = [];
    for (const path of [
      "packages/birmel/Dockerfile",
      "packages/streambot/Dockerfile",
    ]) {
      const dockerfile = await read(path);
      const version = /^ARG YT_DLP_VERSION=(\S+)$/m.exec(dockerfile);
      expect(version).not.toBeNull();
      if (version === null) {
        throw new Error(`${path} is missing its yt-dlp version pin`);
      }
      versions.push(version[1] ?? "");
      expect(dockerfile).toContain(
        "# renovate: datasource=github-releases depName=yt-dlp/yt-dlp",
      );
      expect(dockerfile).toContain('"$base/SHA2-256SUMS"');
      expect(dockerfile).toContain(
        "sha256sum -c --ignore-missing SHA2-256SUMS",
      );
      expect(dockerfile).not.toContain("ARG YT_DLP_AMD64_SHA256");
      expect(dockerfile).not.toContain("ARG YT_DLP_ARM64_SHA256");
      expect(dockerfile).not.toContain("releases/latest/download");
    }
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).not.toBe("");
  });

  test("pins uv instead of resolving the newest package during a build", async () => {
    const dockerfile = await read("packages/discord-plays-pokemon/Dockerfile");
    expect(dockerfile).toMatch(
      /# renovate: datasource=pypi depName=uv\nARG UV_VERSION=\d+\.\d+\.\d+/,
    );
    expect(dockerfile).toContain('"uv==${UV_VERSION}"');
    expect(dockerfile).not.toContain("--no-cache-dir uv \\");
  });

  test("rejects a Scout candidate whose baked contract hash is stale", async () => {
    const child = Bun.spawn(
      ["bun", ".buildkite/scripts/smoke-app-in-image.ts"],
      {
        cwd: repoRoot,
        env: {
          ...Bun.env,
          CI_IMAGE_SMOKE_TARGET: "scout-for-lol",
          CONTRACT_HASH: "candidate-contract",
          EXPECTED_CONTRACT_HASH: "current-contract",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      "Scout contract hash mismatch: expected current-contract, found candidate-contract",
    );
  });
});
