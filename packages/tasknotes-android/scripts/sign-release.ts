import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { nativeInputs } from "./native-inputs";
import {
  outsideRepository,
  signingConfiguration,
  signingCommand,
  signatureVerificationCommand,
} from "./release-policy";

/** Local review/export only: no key creation, enrollment, upload or Store API. */
const root = resolve(import.meta.dir, "..");
const repo = resolve(root, "../..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing ${name} argument.`);
  return value;
}
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--dry-run") continue;
  if (!["--credentials", "--output"].includes(argument ?? ""))
    throw new Error("Unknown release argument.");
  index++;
}
const unsigned = join(root, "app/build/outputs/bundle/release/app-release.aab");
const output = resolve(
  option("--output") ?? join(root, "artifacts/release/facet-release.aab"),
);
const credentials = option("--credentials");
if (!dryRun && !credentials)
  throw new Error(
    "Signing requires --credentials pointing to an ignored bootstrap JSON with an existing external upload keystore, reviewed certificate SHA256 and configured 1Password password references. Play enrollment remains separate.",
  );
if (unsigned === output)
  throw new Error("Signed output must preserve the unsigned source bundle.");
const configuration = credentials
  ? await readConfiguration(credentials)
  : undefined;
async function readConfiguration(file: string) {
  if (!outsideRepository(repo, resolve(file))) {
    const ignored = Bun.spawn(
      ["git", "check-ignore", "--quiet", "--", resolve(file)],
      { cwd: repo, stdout: "ignore", stderr: "ignore" },
    );
    if ((await ignored.exited) !== 0)
      throw new Error(
        "Signing bootstrap references inside the repository must live in an ignored file.",
      );
  }
  let value: unknown;
  try {
    value = await Bun.file(resolve(file)).json();
  } catch {
    throw new Error(
      "Signing bootstrap JSON could not be read; credentials and paths are withheld.",
    );
  }
  return signingConfiguration(value, repo);
}
if (configuration) {
  let actualKey: string;
  try {
    actualKey = await realpath(configuration.keystorePath);
  } catch {
    throw new Error(
      "Configured upload keystore is unavailable; its path and provider details are withheld.",
    );
  }
  if (!outsideRepository(await realpath(repo), actualKey))
    throw new Error(
      "Resolved signing keystore must remain outside the repository.",
    );
  let stat;
  try {
    stat = await lstat(actualKey);
  } catch {
    throw new Error(
      "Configured upload keystore access failed; its path and provider details are withheld.",
    );
  }
  if (
    !stat.isFile() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw new Error(
      "Signing keystore must be a private regular file; correct its access permissions before release.",
    );
}
async function hash(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const part of Bun.file(file).stream()) hasher.update(part);
  return hasher.digest("hex");
}
async function run(command: string[], env = process.env): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `${command[0]} release operation failed (exit ${code}); output withheld to protect credential/provider diagnostics.`,
    );
  return stdout;
}
async function authoredInputs(): Promise<Record<string, string>> {
  const child = Bun.spawn(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "packages/tasknotes-android",
      "packages/tasknotes-macos/scripts/generate-native-notices.ts",
      "packages/tasknotes-macos/scripts/license-texts",
      "bun.lock",
      "LICENSE",
      ".mise.toml",
    ],
    { cwd: repo, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0)
    throw new Error("Release authored-source inventory is unavailable.");
  const inputs: Record<string, string> = {};
  for (const file of stdout.split("\0").filter(Boolean).sort())
    inputs[file] = await hash(join(repo, file));
  if (Object.keys(inputs).length === 0)
    throw new Error("Release authored-source inventory is empty.");
  return inputs;
}
const source = await nativeInputs(root);
const nativeManifest: unknown = await Bun.file(
  join(root, "build/rust-jni/source.manifest.json"),
).json();
if (
  typeof nativeManifest !== "object" ||
  nativeManifest === null ||
  !Object.hasOwn(nativeManifest, "fingerprint") ||
  Reflect.get(nativeManifest, "fingerprint") !== source.fingerprint
)
  throw new Error(
    "Native source manifest is stale; build both ABIs from the current coherent producer before release.",
  );
const authored = await authoredInputs();
const sdk = process.env["ANDROID_HOME"];
if (!sdk)
  throw new Error("ANDROID_HOME must identify the installed Android SDK.");
const ndkRevision = "28.2.13676358";
const ndk = join(sdk, "ndk", ndkRevision);
const ndkProperties = await Bun.file(join(ndk, "source.properties")).text();
if (
  !new RegExp(
    "^Pkg\\.Revision\\s*=\\s*" + ndkRevision.replaceAll(".", "\\.") + "\\s*$",
    "m",
  ).test(ndkProperties)
)
  throw new Error("Release requires the pinned Android NDK revision.");
const hostTag =
  process.platform === "darwin"
    ? "darwin-x86_64"
    : process.platform === "linux"
      ? "linux-x86_64"
      : process.platform === "win32"
        ? "windows-x86_64"
        : undefined;
if (!hostTag)
  throw new Error("The release host has no supported pinned NDK toolchain.");
const stripTool = resolve(
  ndk,
  "toolchains/llvm/prebuilt",
  hostTag,
  "bin",
  "llvm-strip" + (process.platform === "win32" ? ".exe" : ""),
);
const stripToolResolvedPath = await realpath(stripTool);
const stripToolSHA256 = await hash(stripTool);
const stripVersion = await run([stripTool, "--version"]);
if (!stripVersion.includes("LLVM version 19.0.1"))
  throw new Error("The pinned NDK strip tool version does not match.");
const originalNative: Record<string, string> = {};
for (const abi of ["arm64-v8a", "x86_64"])
  originalNative[abi] = await hash(
    join(root, "build/rust-jni", abi, "libtasknotes_core_ffi.so"),
  );
// Gradle must produce the review bundle from the captured native/app graph;
// a pre-existing AAB is never silently relabeled as a current-source build.
await run(["gradle", "--quiet", ":app:bundleRelease"]);
const before = await hash(unsigned);
const staging = join(
  root,
  "artifacts/release",
  "pending-" + crypto.randomUUID(),
);
await mkdir(staging, { recursive: true, mode: 0o700 });
await chmod(staging, 0o700);
const candidate = join(staging, "facet-release.aab");
const manifest = join(staging, "AndroidManifest.xml");
const verify = join(import.meta.dir, "ValidateSignedBundle.java");
const validate = async (bundle: string) =>
  run([
    "gradle",
    "--quiet",
    ":app:validateReleaseBundle",
    `-PfacetBundle=${bundle}`,
  ]);
try {
  await validate(unsigned);
  const xml = await run([
    "gradle",
    "--quiet",
    ":app:dumpReleaseManifest",
    `-PfacetBundle=${unsigned}`,
  ]);
  await Bun.write(manifest, xml);
  const nativeValidation = await run([
    "java",
    verify,
    unsigned,
    unsigned,
    "unsigned",
    join(repo, "LICENSE"),
    join(root, "build/rust-jni"),
    manifest,
    stripTool,
  ]);
  if (!dryRun) {
    if (!configuration)
      throw new Error("Signing bootstrap configuration is missing.");
    if (
      (await Bun.file(output).exists()) ||
      (await Bun.file(output + ".review.json").exists())
    )
      throw new Error(
        "Release output already exists; choose a new review artifact path.",
      );
    const env = {
      ...process.env,
      FACET_STORE_PASSWORD: configuration.storePasswordReference,
      FACET_KEY_PASSWORD: configuration.keyPasswordReference,
    };
    await run(signingCommand(configuration, unsigned, candidate), env);
    await run(signatureVerificationCommand(configuration, candidate), env);
    await run([
      "java",
      verify,
      unsigned,
      candidate,
      configuration.certificateSHA256,
      join(repo, "LICENSE"),
      join(root, "build/rust-jni"),
      manifest,
      stripTool,
    ]);
    await validate(candidate);
  }
  if (
    (await hash(unsigned)) !== before ||
    (await nativeInputs(root)).fingerprint !== source.fingerprint ||
    JSON.stringify(await authoredInputs()) !== JSON.stringify(authored)
  )
    throw new Error(
      "Release producer/source bundle changed during validation; repeat against one coherent source.",
    );
  for (const abi of ["arm64-v8a", "x86_64"])
    if (
      (await hash(
        join(root, "build/rust-jni", abi, "libtasknotes_core_ffi.so"),
      )) !== originalNative[abi]
    )
      throw new Error("Native source changed during release validation.");
  if (
    (await hash(stripTool)) !== stripToolSHA256 ||
    (await Bun.file(join(ndk, "source.properties")).text()) !== ndkProperties
  )
    throw new Error(
      "Pinned NDK tool inputs changed during release validation.",
    );
  await mkdir(dirname(output), { recursive: true });
  const report = {
    schemaVersion: 1,
    applicationId: "red.sjer.facet",
    registeredIdentity: false,
    signed: !dryRun,
    unsignedSHA256: before,
    artifactSHA256: dryRun ? before : await hash(candidate),
    uploadCertificateSHA256: dryRun ? null : configuration?.certificateSHA256,
    nativeSource: source,
    authoredInputs: authored,
    manifestSHA256: await hash(manifest),
    nativeTransformation: {
      ndkRevision,
      stripToolResolvedPath,
      stripToolSHA256,
      stripVersion: stripVersion.trim(),
      originalNative,
      validation: nativeValidation.trim(),
    },
    storeSubmission: "not performed",
    liveSyncAcceptance: "not performed",
  };
  if (!dryRun) {
    await copyFile(candidate, output, constants.COPYFILE_EXCL);
    const artifact = await open(output, "r");
    try {
      await artifact.sync();
    } finally {
      await artifact.close();
    }
  }
  const review = await open(output + ".review.json", "wx", 0o600);
  try {
    await review.writeFile(JSON.stringify(report, null, 2));
    await review.sync();
  } finally {
    await review.close();
  }
  console.log(
    dryRun
      ? "Unsigned release validated locally; signing/enrollment/submission remain unverified."
      : "Signed bundle exported and validated locally; no Store enrollment or submission performed.",
  );
} finally {
  await rm(staging, { recursive: true });
}
