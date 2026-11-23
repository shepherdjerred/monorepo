import {
  packReplayRows,
  replayRowProjection,
  replayColumnTransfers,
} from "../latest-replay-columns.mjs";
import { assertDirectCompiledDataGraph } from "../latest-direct-compiled-restore.mjs";

// Browser reproduction for the large-column property-enumeration failure.
// This is a storage control, not a rendered match or performance acceptance.
export function checkLargeReplayColumns() {
  const bytes = 64 * 1024 * 1024;
  const packed = structuredClone(
    packReplayRows([
      { id: 1, raw: "0000" },
      { id: 2, raw: "ffff" },
    ]),
  );
  const raw = packed.groups[0].fields.find(
    (field) => field.name === "raw",
  ).column;
  raw.data.buffer = new ArrayBuffer(bytes);
  raw.data.length = bytes;
  raw.offsets.buffer = new Uint32Array([0, bytes / 2, bytes]).buffer;
  assertDirectCompiledDataGraph(packed);
  const projection = replayRowProjection(packed, 1, ["id"]);
  if (projection.id !== 2)
    throw Error("Large replay column projection changed identity");
  const received = structuredClone(packed, {
    transfer: replayColumnTransfers(packed),
  });
  if (raw.data.buffer.byteLength !== 0)
    throw Error("Original replay column retained transfer ownership");
  const receivedRaw = received.groups[0].fields.find(
    (field) => field.name === "raw",
  ).column;
  if (receivedRaw.data.buffer.byteLength !== bytes)
    throw Error("Transferred replay column buffer length changed");
  assertDirectCompiledDataGraph(received);
  if (replayRowProjection(received, 0, ["id"]).id !== 1)
    throw Error("Large transferred replay column changed identity");
  return {
    bytes,
    compiledGraphValidated: true,
    transferred: true,
    rows: received.length,
  };
}

if (globalThis.Bun?.isMainThread === true)
  console.log(JSON.stringify(checkLargeReplayColumns()));
