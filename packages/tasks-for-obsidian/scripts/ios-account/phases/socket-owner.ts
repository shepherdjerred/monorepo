import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import path from "node:path";

let active = false;
/** Relative Darwin socket paths remain confined to one isolated host process. */
export async function withOwnedAccountSocket<T>(
  directoryPath: string,
  sessionID: string,
  work: (socket: Socket) => Promise<T>,
) {
  assert.equal(
    active,
    false,
    "Only one private account session may own the process directory",
  );
  const original = process.cwd();
  active = true;
  try {
    const uid = process.getuid?.();
    assert.ok(uid !== undefined && uid !== 0);
    const directory = await lstat(directoryPath);
    assert.ok(
      directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        directory.uid === uid &&
        (directory.mode & 0o777) === 0o700,
    );
    assert.equal(await realpath(directoryPath), directoryPath);
    const name = `facet-account-${sessionID}.sock`,
      file = path.join(directoryPath, name),
      metadata = await lstat(file);
    assert.ok(
      metadata.isSocket() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === uid &&
        (metadata.mode & 0o777) === 0o600,
    );
    process.chdir(directoryPath);
    const socket = createConnection({ path: name });
    try {
      return await work(socket);
    } finally {
      socket.destroy();
    }
  } finally {
    process.chdir(original);
    active = false;
  }
}
