// Runs a release script with only the secrets that step needs, resolved from
// 1Password through the repository's service-account wrapper:
//
//   bun scripts/with-release-credentials.ts <stable|beta> <entry.ts> [args...]
//
// `package-release.ts` gets the channel's update signing key and password.
// `publish-release.ts` gets the release bucket's credentials. The child never
// inherits the service-account token. `--dry-run` runs without any secrets.
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repository = path.resolve(desktop, "../../../..");
const [channel, entry, ...rest] = process.argv.slice(2);
if ((channel !== "stable" && channel !== "beta") || entry === undefined) {
  throw new Error("usage: with-release-credentials.ts stable|beta <entry.ts>");
}
const environmentFiles: Record<string, string> = {
  "package-release.ts": `release-signing.${channel}.env`,
  "publish-release.ts": "release-publication.env",
};
const environmentFile = environmentFiles[entry];
if (environmentFile === undefined) {
  throw new Error(`${entry} is not a release step`);
}

const command = [
  process.execPath,
  path.join(desktop, "scripts", entry),
  channel,
  ...rest,
];
const argv = rest.includes("--dry-run")
  ? command
  : [
      "bash",
      "scripts/onepassword/with-service-account.sh",
      "op",
      "run",
      `--env-file=${path.relative(repository, path.join(desktop, environmentFile))}`,
      "--",
      "env",
      "-u",
      "OP_SERVICE_ACCOUNT_TOKEN",
      ...command,
    ];
const child = Bun.spawn(argv, {
  cwd: repository,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
