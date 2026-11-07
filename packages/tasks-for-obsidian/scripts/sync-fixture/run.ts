import assert from "node:assert/strict";
import { z } from "zod";
import { startSyncFixture } from "./server";

const [directoryFlag, directory, runFlag, runID] = Bun.argv.slice(2);
assert.equal(
  Bun.argv.length,
  6,
  "Usage: run.ts --directory <owned-private-directory> --run-id <UUID>",
);
assert.equal(directoryFlag, "--directory");
assert.equal(runFlag, "--run-id");
assert.ok(directory);
const fixture = await startSyncFixture({
  directory,
  runID: z.uuid().parse(runID),
});
console.log(JSON.stringify(fixture.identity));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await fixture.close();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
