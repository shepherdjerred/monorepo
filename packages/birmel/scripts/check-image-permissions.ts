import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const violations: string[] = [];

/** Image-only smoke: fail if copying a layer changed the sandbox boundary. */
async function checkTree(directory: string): Promise<number> {
  const metadata = await lstat(directory);
  const writableData =
    directory === "/app/data" || directory.startsWith("/app/data/");
  const expectedUid = writableData ? 1000 : 0;
  if (metadata.uid !== expectedUid || metadata.gid !== 1000) {
    violations.push(
      `Unexpected image owner ${String(metadata.uid)}:${String(metadata.gid)} at ${directory}`,
    );
  }
  if (!writableData && !metadata.isSymbolicLink()) {
    if ((metadata.mode & 0o007) !== 0 || (metadata.mode & 0o040) === 0) {
      violations.push(
        `Unexpected application mode ${(metadata.mode & 0o777).toString(8)} at ${directory}`,
      );
    }
    if (metadata.isDirectory() && (metadata.mode & 0o010) === 0) {
      violations.push(`Application group cannot traverse ${directory}`);
    }
  }
  if (directory === "/app/data" && (metadata.mode & 0o777) !== 0o700) {
    violations.push("Application data must remain private to uid 1000");
  }
  let count = 1;
  if (metadata.isDirectory()) {
    for (const name of await readdir(directory)) {
      count += await checkTree(path.join(directory, name));
    }
  }
  return count;
}

const paths = await checkTree("/app");
if (violations.length > 0) {
  throw new Error(
    `${String(violations.length)} image permission violations:\n${violations.slice(0, 20).join("\n")}`,
  );
}
console.log(
  `Image ownership and access policy passed for ${String(paths)} paths`,
);
