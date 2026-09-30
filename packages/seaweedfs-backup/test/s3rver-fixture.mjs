import S3rver from "s3rver";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
const buckets = process.argv.slice(3);
if (directory === undefined || buckets.length === 0) {
  throw new Error("Usage: s3rver-fixture.mjs <directory> <bucket...>");
}

await Promise.all(
  buckets.map((bucket) =>
    mkdir(path.join(directory, bucket), { recursive: true }),
  ),
);
const s3rver = new S3rver({
  address: "127.0.0.1",
  port: 0,
  silent: true,
  directory,
});
const server = s3rver;
const addressInfo = await s3rver.run();
if (
  addressInfo === null ||
  typeof addressInfo !== "object" ||
  !("port" in addressInfo)
) {
  throw new Error("S3 test server returned invalid startup output");
}
console.log(addressInfo.port);

async function shutdown() {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
