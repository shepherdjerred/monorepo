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
  hostname: "127.0.0.1",
  port: 0,
  silent: true,
  directory,
});
let server;
const port = await new Promise((resolve, reject) => {
  server = s3rver.run((error, _hostname, listeningPort) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(listeningPort);
  });
});
console.log(port);

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
