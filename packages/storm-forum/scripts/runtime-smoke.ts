import assert from "node:assert/strict";
import { NativeConnection } from "@temporalio/worker";
import { createForumConfig } from "#src/config.ts";
assert.equal(typeof NativeConnection.connect, "function");
assert.equal(await createForumConfig().value("registrationEnabled"), false);
assert.equal(
  await Bun.file("/app/forum/src/XF.php").exists(),
  false,
  "Public image must not contain licensed XenForo",
);
const execute = async (args: string[]) => {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exitCode, 0, stderr);
  return stdout;
};
for (const file of new Bun.Glob(
  "{addon,runtime,test,themes}/**/*.php",
).scanSync("/opt/storm-forum")) {
  await execute(["php", "-l", `/opt/storm-forum/${file}`]);
}
const extensions = await execute(["php", "-m"]);
for (const extension of [
  "mysqli",
  "gd",
  "zip",
  "intl",
  "exif",
  "mbstring",
  "openssl",
]) {
  assert.ok(
    extensions.includes(extension),
    `Missing PHP extension: ${extension}`,
  );
}
process.stdout.write(
  "Owned runtime, PHP syntax, Temporal core, and licensed-content exclusion checks passed.\n",
);
