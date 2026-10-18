import assert from "node:assert/strict";
import { mkdir, unlink, rmdir } from "node:fs/promises";
import { NativeConnection } from "@temporalio/worker";
import { createForumConfig, forumManifest } from "#src/config.ts";
import { MinecraftStatusSchema } from "#src/minecraft-cache.ts";
import { publicQueryContract } from "#src/minecraft-query.ts";
import { forumNativeObservation } from "@shepherdjerred/ops-model/forum/native-observation.ts";
assert.equal(publicQueryContract.schemaVersion, 2);
MinecraftStatusSchema.parse(
  await Bun.file("/opt/storm-forum/test/fixtures/minecraft-status.json").json(),
);
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
const phpManifest = JSON.parse(
  await execute([
    "php",
    "-r",
    "echo json_encode((require '/opt/storm-forum/runtime/manifest.php')(), JSON_THROW_ON_ERROR);",
  ]),
) as unknown;
assert.deepEqual(
  phpManifest,
  forumManifest,
  "PHP and TypeScript must consume the same neutral dependency policy and product manifest",
);
for (const [setup, expectedStatus] of [
  ["putenv('DELIVERY_FORUM_OBSERVATION_TOKEN');", 503],
  ["putenv('DELIVERY_FORUM_OBSERVATION_TOKEN=' . str_repeat('a', 40));", 401],
  [
    "putenv('DELIVERY_FORUM_OBSERVATION_TOKEN=' . str_repeat('a', 40)); $_SERVER['HTTP_AUTHORIZATION']='Bearer ' . str_repeat('a', 40); $_SERVER['REQUEST_METHOD']='POST';",
    405,
  ],
] as const) {
  const observation = await execute([
    "php",
    "-r",
    `${setup} ob_start(); require '/opt/storm-forum/runtime/delivery-status.php'; ob_end_clean(); echo http_response_code();`,
  ]);
  assert.equal(
    Number(observation),
    expectedStatus,
    "Observer must fail closed before any installed DB read",
  );
}
// Exercise the real observer PHP and fixed native recipe against a synthetic
// XF bootstrap that closes buffers, as the deployed legacy runtime does.
await mkdir("/app/forum/src", { recursive: true });
try {
  await Bun.write(
    "/app/forum/src/XF.php",
    Bun.file("/opt/storm-forum/test/fixtures/observation-xf.php"),
  );
  await Bun.write("/app/forum/.storm-assembly", "a".repeat(64));
  const expected = {
    schemaVersion: 1,
    state: "installed",
    xenforoVersion: "2.3.13",
    bundleSha256: "a".repeat(64),
    maintenance: false,
    releaseLock: false,
  };
  for (const args of [
    [...forumNativeObservation.command],
    [
      "php",
      "-r",
      "putenv('DELIVERY_FORUM_OBSERVATION_TOKEN=' . str_repeat('a', 40)); $_SERVER['HTTP_AUTHORIZATION']='Bearer ' . str_repeat('a', 40); $_SERVER['REQUEST_METHOD']='GET'; ob_start(); require '/opt/storm-forum/runtime/delivery-status.php';",
    ],
  ])
    assert.deepEqual(
      JSON.parse(await execute(args)),
      expected,
      "Installed observer must survive XF closing the caller's output buffers",
    );
} finally {
  await unlink("/app/forum/src/XF.php");
  await unlink("/app/forum/.storm-assembly");
  await rmdir("/app/forum/src");
}
assert.equal(
  await Bun.file("/app/forum/src/XF.php").exists(),
  false,
  "Synthetic observation fixture must not remain in the published runtime",
);
const extensions = await execute(["php", "-m"]);
for (const extension of [
  "mysqli",
  "gd",
  "zip",
  "intl",
  "exif",
  "mbstring",
  "openssl",
  "Zend OPcache",
]) {
  assert.ok(
    extensions.includes(extension),
    `Missing PHP extension: ${extension}`,
  );
}
process.stdout.write(
  "Owned runtime, PHP syntax, Temporal core, and licensed-content exclusion checks passed.\n",
);
