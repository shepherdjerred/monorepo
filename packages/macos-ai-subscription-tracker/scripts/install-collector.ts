import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rmdir,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { resolveXcodeEnvironment } from "./xcode-env.ts";

const label = "com.sjerred.brim-collector";
const service = "BRIM_MACBOOK_PUBLISH_TOKEN";
const uid = process.getuid?.();
const [baseURL, ...extra] = process.argv.slice(2);
if (process.platform !== "darwin" || uid === undefined || uid === 0) {
  throw new Error(
    "Install the collector from MacBook’s logged-in user session.",
  );
}
const endpoint = baseURL === undefined ? undefined : URL.parse(baseURL);
if (
  endpoint === undefined ||
  endpoint === null ||
  endpoint.protocol !== "https:" ||
  [endpoint.username, endpoint.password, endpoint.search, endpoint.hash].some(
    Boolean,
  ) ||
  extra.length > 0
) {
  throw new Error("Usage: bun run install:collector <https-base-url>");
}
const toolkit = Bun.which("toolkit");
if (toolkit === null)
  throw new Error("Install toolkit before enrolling the collector.");

function run(command: string[]) {
  const result = Bun.spawnSync(command, {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0)
    throw new Error(`${command[0]} exited ${String(result.exitCode)}.`);
}

function xmlString(value: string): string {
  return `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</string>`;
}

const packageRoot = resolve(import.meta.dir, "..");
const collector = join(homedir(), ".local", "bin", "brim-collector");
const launchAgents = join(homedir(), "Library", "LaunchAgents");
const launchPlist = join(launchAgents, `${label}.plist`);
const logDir = join(homedir(), "Library", "Logs", "BrimCollector");
const launchTarget = `gui/${String(uid)}`;
const program = [
  toolkit,
  "run",
  "--env",
  service,
  "--",
  collector,
  endpoint.href,
];
const path = [
  dirname(toolkit),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
].join(":");

run(["bun", "run", "--cwd", packageRoot, "build:collector"]);
const binPath = Bun.spawnSync(
  ["swift", "build", "-c", "release", "--show-bin-path"],
  {
    cwd: packageRoot,
    env: await resolveXcodeEnvironment(),
    stderr: "inherit",
  },
);
if (binPath.exitCode !== 0)
  throw new Error("Swift could not report its build output path.");
const binarySource = join(binPath.stdout.toString().trim(), "brim-collector");
await mkdir(dirname(collector), { recursive: true });
await mkdir(launchAgents, { recursive: true });
await mkdir(logDir, { recursive: true, mode: 0o700 });

const binaryTemp = await mkdtemp(join(dirname(collector), ".brim-collector-"));
const preparedBinary = join(binaryTemp, basename(collector));
await copyFile(binarySource, preparedBinary);
await chmod(preparedBinary, 0o755);
const plistTemp = await mkdtemp(join(launchAgents, ".brim-collector-"));
const preparedPlist = join(plistTemp, basename(launchPlist));
await Bun.write(
  preparedPlist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>${xmlString(label)}
  <key>ProgramArguments</key><array>${program.map(xmlString).join("")}</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key>${xmlString(path)}</dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key>${xmlString(join(logDir, "collector.log"))}
</dict></plist>
`,
);
run(["/usr/bin/plutil", "-lint", preparedPlist]);
await rename(preparedBinary, collector);
await rename(preparedPlist, launchPlist);
await rmdir(binaryTemp);
await rmdir(plistTemp);

const launchService = `${launchTarget}/${label}`;
if (Bun.spawnSync(["/bin/launchctl", "print", launchService]).exitCode === 0) {
  run(["/bin/launchctl", "bootout", launchService]);
}
run(["/bin/launchctl", "bootstrap", launchTarget, launchPlist]);
console.log(
  `Installed ${label}. Check ${join(logDir, "collector.log")} for collection errors.`,
);
