import type { Secret, Directory, Container, File } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import versions from "./lib-versions.ts";
import {
  getCrossCompileContainer,
  uploadReleaseAssets,
  CLAUDERON_TARGETS,
} from "./index-infra.ts";

const BUN_VERSION = versions.bun;
const LATEX_IMAGE = "blang/latex:ubuntu";

/**
 * Build the clauderon docs site container.
 */
export function buildMuxSiteContainer(source: Directory): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source.directory("packages/clauderon/docs"))
    .withExec(["bun", "install"])
    .withExec(["bun", "run", "build"]);
}

/**
 * Get the built clauderon docs output directory.
 */
export function getMuxSiteOutput(source: Directory): Directory {
  return buildMuxSiteContainer(source).directory("/workspace/dist");
}

/**
 * Deploy clauderon docs to S3.
 */
export async function deployMuxSite(
  source: Directory,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
): Promise<string> {
  const outputs: string[] = [];
  const siteDir = getMuxSiteOutput(source);
  outputs.push("✓ Built clauderon docs");

  const syncOutput = await syncToS3({
    sourceDir: siteDir,
    bucketName: "clauderon",
    endpointUrl: "https://seaweedfs.sjer.red",
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    region: "us-east-1",
    deleteRemoved: true,
  });

  outputs.push("✓ Deployed to SeaweedFS S3 (bucket: clauderon)");
  outputs.push(syncOutput);
  return outputs.join("\n");
}

/**
 * Build the resume PDF file.
 */
export function buildResumeFile(source: Directory): File {
  return dag
    .container()
    .from(LATEX_IMAGE)
    .withMountedDirectory("/workspace", source.directory("packages/resume"))
    .withWorkdir("/workspace")
    .withExec(["pdflatex", "resume.tex"])
    .file("/workspace/resume.pdf");
}

/**
 * Get resume output directory with PDF and HTML.
 */
export function getResumeOutput(source: Directory): Directory {
  const pdf = buildResumeFile(source);
  const resumeDir = source.directory("packages/resume");
  return dag
    .directory()
    .withFile("resume.pdf", pdf)
    .withFile("index.html", resumeDir.file("index.html"));
}

/**
 * Deploy resume to S3.
 */
export async function deployResumeSite(
  source: Directory,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
): Promise<string> {
  const outputs: string[] = [];
  const outputDir = getResumeOutput(source);
  outputs.push("✓ Built resume.pdf");

  const syncOutput = await syncToS3({
    sourceDir: outputDir,
    bucketName: "resume",
    endpointUrl: "https://seaweedfs.sjer.red",
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    region: "us-east-1",
    deleteRemoved: true,
  });

  outputs.push("✓ Deployed to SeaweedFS S3 (bucket: resume)");
  outputs.push(syncOutput);
  return outputs.join("\n");
}

/**
 * Build multiplexer binaries for all Linux targets.
 */
export function buildMultiplexerBinaries(
  source: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret,
): Directory {
  const container = getCrossCompileContainer(
    source,
    s3AccessKeyId,
    s3SecretAccessKey,
  );
  const linuxTargets = CLAUDERON_TARGETS.filter((t) => t.os === "linux");
  let outputContainer = dag.directory();

  for (const { target, os, arch } of linuxTargets) {
    let buildContainer = container
      .withEnvVariable("CARGO_TARGET_DIR", `/workspace/target-cross-${arch}`)
      .withMountedCache(
        `/workspace/target-cross-${arch}`,
        dag.cacheVolume(`clauderon-cross-target-${arch}`),
      );

    if (target === "aarch64-unknown-linux-gnu") {
      const cargoConfig = `
[registries.crates-io]
protocol = "sparse"

[build]
jobs = -1

[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"

[net]
retry = 3
`;
      buildContainer = buildContainer
        .withNewFile("/workspace/.cargo/config.toml", cargoConfig)
        .withEnvVariable("OPENSSL_DIR", "/usr")
        .withEnvVariable("OPENSSL_LIB_DIR", "/usr/lib/aarch64-linux-gnu")
        .withEnvVariable("OPENSSL_INCLUDE_DIR", "/usr/include")
        .withEnvVariable("PKG_CONFIG_ALLOW_CROSS", "1")
        .withEnvVariable(
          "PKG_CONFIG_PATH",
          "/usr/lib/aarch64-linux-gnu/pkgconfig",
        );
    }

    buildContainer = buildContainer.withExec([
      "cargo",
      "build",
      "--release",
      "--target",
      target,
    ]);
    const binaryPath = `/workspace/target-cross-${arch}/${target}/release/clauderon`;
    const filename = `clauderon-${os}-${arch}`;
    outputContainer = outputContainer.withFile(
      filename,
      buildContainer.file(binaryPath),
    );
  }

  return outputContainer;
}

type ReleaseMultiplexerOptions = {
  source: Directory;
  version: string;
  githubToken: Secret;
  s3AccessKeyId?: Secret | undefined;
  s3SecretAccessKey?: Secret | undefined;
  clauderonCiFn: (
    source: Directory,
    frontendDist?: Directory,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ) => Promise<string>;
};

/**
 * Run full multiplexer release: CI + build + upload.
 */
export async function releaseMultiplexer(
  options: ReleaseMultiplexerOptions,
): Promise<string> {
  const {
    source,
    version,
    githubToken,
    s3AccessKeyId,
    s3SecretAccessKey,
    clauderonCiFn,
  } = options;
  const outputs: string[] = [];

  outputs.push("--- Clauderon CI ---");
  outputs.push(
    await clauderonCiFn(source, undefined, s3AccessKeyId, s3SecretAccessKey),
  );

  outputs.push("\n--- Building Binaries ---");
  const binaries = buildMultiplexerBinaries(
    source,
    s3AccessKeyId,
    s3SecretAccessKey,
  );

  const linuxTargets = CLAUDERON_TARGETS.filter((t) => t.os === "linux");
  const filenames = linuxTargets.map(
    ({ os, arch }) => `clauderon-${os}-${arch}`,
  );
  for (const filename of filenames) {
    outputs.push(`✓ Built ${filename}`);
  }

  outputs.push("\n--- Uploading to GitHub Release ---");
  const uploadResults = await uploadReleaseAssets(
    githubToken,
    version,
    binaries,
    filenames,
  );
  outputs.push(...uploadResults.outputs);

  if (uploadResults.errors.length > 0) {
    throw new Error(
      `Failed to upload ${String(uploadResults.errors.length)} asset(s):\n${uploadResults.errors.join("\n")}`,
    );
  }

  return outputs.join("\n");
}
