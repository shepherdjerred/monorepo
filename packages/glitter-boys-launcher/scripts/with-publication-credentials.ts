import path from "node:path";

const repository = path.resolve(import.meta.dir, "../../..");
const entry = process.argv[2];
if (!entry) throw new Error("A release command is required");
const command = [
  process.execPath,
  path.resolve(import.meta.dir, entry),
  ...process.argv.slice(3),
];
const names = [
  "SEAWEEDFS_SITES_ACCESS_KEY_ID",
  "SEAWEEDFS_SITES_SECRET_ACCESS_KEY",
];
const env = { ...process.env };
const supplied = names.filter((name) => Boolean(env[name]?.trim()));
if (supplied.length !== 0 && supplied.length !== names.length)
  throw new Error(
    "Both static-site publication credentials must be injected together",
  );
let argv: string[];
if (supplied.length === names.length || process.argv.includes("--dry-run")) {
  Reflect.deleteProperty(env, "OP_SERVICE_ACCOUNT_TOKEN");
  argv = command;
} else {
  const programFiles = process.env["ProgramFiles"];
  if (!programFiles)
    throw new Error("Signed publication requires Windows with Git for Windows");
  const bash = path.join(programFiles, "Git/bin/bash.exe");
  if (!(await Bun.file(bash).exists()))
    throw new Error("Install Git for Windows before publishing");
  argv = [
    bash,
    "scripts/onepassword/with-service-account.sh",
    "op",
    "run",
    "--env-file=packages/glitter-boys-launcher/publication.env",
    "--",
    "env",
    "-u",
    "OP_SERVICE_ACCOUNT_TOKEN",
    ...command,
  ];
}
const child = Bun.spawn(argv, {
  cwd: repository,
  env,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
