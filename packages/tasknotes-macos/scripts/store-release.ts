import { join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { validateNativeLicenseResources } from "./native-license-resources.ts";

/** Local archive/export only. This lane never uploads or changes Store records. */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const platform = args.includes("--ios") ? "ios" : "macos";
const teamIndex = args.indexOf("--team-id");
const team = teamIndex < 0 ? undefined : args[teamIndex + 1];
const optionsIndex = args.indexOf("--export-options");
const options = optionsIndex < 0 ? undefined : args[optionsIndex + 1];
const repo = resolve(import.meta.dir, "../../..");
const root =
  platform === "ios"
    ? join(repo, "packages/tasks-for-obsidian/ios")
    : resolve(import.meta.dir, "..");
const name = platform === "ios" ? "TasksForObsidian" : "TaskNotes";
const identity =
  platform === "ios"
    ? "org.reactjs.native.example.TasksForObsidian"
    : "red.sjer.tasknotes.mac";
const output = join(root, ".build/store-release");
const archive = join(output, `${name}.xcarchive`);

async function run(command: string[], cwd = root): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0)
    throw new Error(`${command[0]} failed.\n${stdout}\n${stderr}`);
  return stdout;
}

async function plist(file: string): Promise<Record<string, unknown>> {
  const result: unknown = JSON.parse(
    await run(["plutil", "-convert", "json", "-o", "-", file]),
  );
  if (typeof result !== "object" || result === null || Array.isArray(result))
    throw new Error("Expected a plist dictionary.");
  return result;
}

async function validateBundle(
  app: string,
  expected: string,
  extension = false,
): Promise<void> {
  const content =
    platform === "macos" && !extension ? join(app, "Contents") : app;
  const info = await plist(join(content, "Info.plist"));
  if (
    info["CFBundleIdentifier"] !== expected ||
    typeof info["CFBundleExecutable"] !== "string"
  )
    throw new Error("Archive has the wrong bundle identity or executable.");
  const executable = join(
    content,
    platform === "macos" && !extension ? "MacOS" : "",
    info["CFBundleExecutable"],
  );
  const archs = (await run(["lipo", "-archs", executable])).trim().split(/\s+/);
  if (
    !archs.includes("arm64") ||
    (platform === "macos" && !archs.includes("x86_64"))
  )
    throw new Error("Store archive architecture set is incomplete.");
  const resources =
    platform === "macos" && !extension ? join(content, "Resources") : content;
  const privacy = await plist(join(resources, "PrivacyInfo.xcprivacy"));
  if (
    privacy["NSPrivacyTracking"] !== false ||
    !Array.isArray(privacy["NSPrivacyAccessedAPITypes"])
  )
    throw new Error("Archive is missing its reviewed native privacy manifest.");
  await validateNativeLicenseResources(
    resources,
    join(repo, "packages/tasknotes-macos/Resources", platform),
    join(repo, "LICENSE"),
  );
  if (!dryRun) {
    await run(["codesign", "--verify", "--deep", "--strict", app]);
    const signature = await run([
      "codesign",
      "-d",
      "--entitlements",
      ":-",
      app,
    ]);
    const entitlementFile = join(
      output,
      extension ? "widget-entitlements.plist" : "app-entitlements.plist",
    );
    await Bun.write(entitlementFile, signature);
    const entitlements = await plist(entitlementFile);
    if (
      entitlements["get-task-allow"] === true ||
      entitlements["com.apple.security.get-task-allow"] === true
    )
      throw new Error("Store executable allows debugging.");
    if (
      platform === "macos" &&
      entitlements["com.apple.security.app-sandbox"] !== true
    )
      throw new Error("Mac App Store executable must be sandboxed.");
    if (
      platform === "ios" &&
      (!Array.isArray(entitlements["com.apple.security.application-groups"]) ||
        !entitlements["com.apple.security.application-groups"].includes(
          "group.com.tasksforobsidian",
        ))
    )
      throw new Error("App and widget AppGroup capability is missing.");
    if (entitlements["com.apple.developer.team-identifier"] !== team)
      throw new Error(
        "Signed executable belongs to a different developer team.",
      );
  }
}

if (process.platform !== "darwin")
  throw new Error("Native Apple archive/export requires macOS and Xcode.");
if (
  !dryRun &&
  (!team ||
    !/^[A-Z0-9]{10}$/.test(team) ||
    !options ||
    !args.includes("--encryption-reviewed"))
) {
  throw new Error(
    "Signed export requires --team-id, a reviewed --export-options plist and --encryption-reviewed after owner export-compliance review.",
  );
}
if (options) {
  const exportOptions = await plist(resolve(options));
  if (
    exportOptions["method"] !== "app-store-connect" ||
    exportOptions["destination"] !== "export" ||
    exportOptions["teamID"] !== team
  )
    throw new Error(
      "Export options must select app-store-connect, local export and the exact developer team.",
    );
}
await run(
  [join(repo, "bin/mise"), "exec", "--", "cargo", "xtask", "check-xcframework"],
  join(repo, "packages/tasknotes-core"),
);
if (platform === "macos") await run(["swift", "package", "resolve"]);
await run([
  join(repo, "bin/mise"),
  "exec",
  "--",
  "bun",
  join(repo, "packages/tasknotes-macos/scripts/generate-native-notices.ts"),
  ...(platform === "ios" ? ["--ios"] : []),
]);
await run([join(repo, "bin/mise"), "exec", "--", "xcodegen", "generate"]);
await run([
  "xcodebuild",
  "-project",
  `${name}.xcodeproj`,
  "-scheme",
  name,
  "-configuration",
  "Release",
  "-destination",
  platform === "ios" ? "generic/platform=iOS" : "generic/platform=macOS",
  "-archivePath",
  archive,
  "archive",
  "ONLY_ACTIVE_ARCH=NO",
  ...(platform === "macos" ? ["ARCHS=arm64 x86_64"] : []),
  ...(dryRun
    ? ["CODE_SIGNING_ALLOWED=NO"]
    : [
        `DEVELOPMENT_TEAM=${team}`,
        "CODE_SIGN_STYLE=Automatic",
        "CODE_SIGN_IDENTITY=Apple Distribution",
      ]),
]);
const app = join(archive, "Products/Applications", `${name}.app`);
await validateBundle(app, identity);
if (platform === "ios") {
  const extensions = await readdir(join(app, "PlugIns"));
  if (extensions.length !== 1 || extensions[0] !== "TasksWidget.appex")
    throw new Error(
      "Registered widget extension is missing or unexpected code was bundled.",
    );
  await validateBundle(
    join(app, "PlugIns/TasksWidget.appex"),
    identity + ".TasksWidget",
    true,
  );
}
if (dryRun)
  console.log(
    `Unsigned native archive validated: ${archive}. Signing, profile capability, export and Store acceptance remain unverified.`,
  );
else {
  if (!options) throw new Error("Reviewed export options are required.");
  await run([
    "xcodebuild",
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportPath",
    join(output, "export"),
    "-exportOptionsPlist",
    resolve(options),
  ]);
  const exported = await readdir(join(output, "export"));
  if (
    !exported.some((file) =>
      file.endsWith(platform === "ios" ? ".ipa" : ".pkg"),
    )
  )
    throw new Error("Local Store export artifact is missing.");
  console.log(
    `Native Store artifact exported locally: ${join(output, "export")}. Nothing was submitted.`,
  );
}
