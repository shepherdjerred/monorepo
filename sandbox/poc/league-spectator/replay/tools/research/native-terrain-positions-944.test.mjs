import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createExactTerrainByteCodecs,
  createPosition944Reader,
  loadPosition944Reader,
  prepareExactTerrainDecoder,
} from "./native-terrain-positions-944.mjs";
import {
  createPreparedTerrainByteCodecs,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";

const replay = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };
const currentReplay = { ...replay, build: "16.23.841.8428" };
const currentOptions = { allowCurrentBuild: true };

test("rejects unknown replay and client identities", () => {
  const bytes = new Uint8Array(39_463_840);
  for (const wrong of [
    { ...replay, build: "16.21.829.8620" },
    { ...replay, protocol: "0000000000000000" },
  ])
    assert.throws(
      () => createPosition944Reader(bytes, wrong),
      /replay protocol/,
    );
  assert.throws(
    () => createPosition944Reader(bytes, replay),
    /macOS client slice/,
  );
});

const localClient = process.env.SCOUT_RESEARCH_OPCODE944_MAC_CLIENT;
const currentClient = process.env.SCOUT_RESEARCH_OPCODE944_CURRENT_MAC_CLIENT;
const referenceBody = process.env.SCOUT_RESEARCH_OPCODE944_BODY;
test("rejects unpinned prepared input through both loaders", async () => {
  const sameSize = new Uint8Array(1024);
  assert.throws(() => createExactTerrainByteCodecs(sameSize, replay), /digest/);
  await assert.rejects(
    createPreparedTerrainByteCodecs(sameSize, replay),
    /digest/,
  );
  await assert.rejects(
    createPreparedTerrainByteCodecs(sameSize.subarray(1), replay),
    /size/,
  );
  await assert.rejects(
    createPreparedTerrainByteCodecs(sameSize, { ...replay, protocol: "0" }),
    /replay protocol/,
  );
});

test("requires explicit opt-in for the current build and checks its protocol", async () => {
  const bytes = new Uint8Array(1024);
  assert.throws(
    () => createExactTerrainByteCodecs(bytes, currentReplay),
    /replay protocol/,
  );
  await assert.rejects(
    createPreparedTerrainByteCodecs(bytes, currentReplay),
    /replay protocol/,
  );
  assert.throws(
    () =>
      createExactTerrainByteCodecs(
        bytes,
        { ...currentReplay, protocol: "0" },
        currentOptions,
      ),
    /replay protocol/,
  );
  await assert.rejects(
    createPreparedTerrainByteCodecs(bytes, currentReplay, currentOptions),
    /digest/,
  );
});

test(
  "pinned current archive and x86 slice independently reproduce the prepared maps",
  { skip: !currentClient },
  async () => {
    const client = await readFile(currentClient);
    const slice = client.subarray(0x4000, 0x4000 + 39_463_840);
    const maps = prepareExactTerrainDecoder(
      client,
      currentReplay,
      currentOptions,
    );
    assert.deepEqual(
      prepareExactTerrainDecoder(slice, currentReplay, currentOptions),
      maps,
    );
    assert.throws(
      () => createExactTerrainByteCodecs(slice, replay),
      /client slice/,
    );
    if (localClient) {
      const previousClient = await readFile(localClient);
      assert.deepEqual(prepareExactTerrainDecoder(previousClient), maps);
      assert.throws(
        () =>
          createExactTerrainByteCodecs(
            previousClient,
            currentReplay,
            currentOptions,
          ),
        /archive digest|client slice/,
      );
    }

    const codecs = createExactTerrainByteCodecs(
      slice,
      currentReplay,
      currentOptions,
    );
    const prepared = await createPreparedTerrainByteCodecs(
      maps,
      currentReplay,
      currentOptions,
    );
    assert.deepEqual(
      recoverTerrainByteSubstitution(prepared),
      new Uint8Array(slice.subarray(0x2148f00, 0x2149000)),
    );
    for (const [name, decode] of Object.entries(codecs))
      for (let byte = 0; byte < 256; byte++)
        assert.equal(decode(byte), prepared[name](byte));

    // A modification to the other architecture must still fail the archive pin.
    client[client.length - 1] ^= 1;
    assert.throws(
      () => createExactTerrainByteCodecs(client, currentReplay, currentOptions),
      /archive digest/,
    );
  },
);

test(
  "prepared and executable byte codecs agree on every byte",
  { skip: !localClient },
  async () => {
    const client = await readFile(localClient);
    const prepared = prepareExactTerrainDecoder(client);
    const fromClient = createExactTerrainByteCodecs(client, replay);
    const fromPreparedNode = createExactTerrainByteCodecs(prepared, replay);
    const fromPreparedBrowser = await createPreparedTerrainByteCodecs(
      prepared,
      replay,
    );
    prepared.fill(0);
    for (const [codec, decode] of Object.entries(fromClient)) {
      const bytes = Array.from({ length: 256 }, (_, byte) => byte);
      assert.deepEqual(bytes.map(fromPreparedNode[codec]), bytes.map(decode));
      assert.deepEqual(
        bytes.map(fromPreparedBrowser[codec]),
        bytes.map(decode),
      );
    }
  },
);

test(
  "exact local asset and reference packet verify position, omission, and malformed bodies",
  { skip: !localClient || !referenceBody },
  async () => {
    const readBody = await loadPosition944Reader(localClient, replay);
    const client = await readFile(localClient);
    const slice =
      client.length === 76_111_280
        ? client.subarray(0x4000, 0x4000 + 39_463_840)
        : client;
    const derived = createPosition944Reader(slice, replay);
    const body = Buffer.from(referenceBody, "hex");
    const expected = { x: 6919, z: 1483 };
    assert.deepEqual(readBody(body), expected);
    assert.deepEqual(derived(body), expected);

    const omitted = Uint8Array.from(body.subarray(0, -8));
    omitted[0] |= 0x40;
    assert.equal(readBody(omitted), null);

    assert.throws(() => readBody(body.subarray(0, 1)), /Truncated/);
    assert.throws(() => readBody(body.subarray(0, -1)), /length|continuation/);
    const wrongHeader = Uint8Array.from(body);
    wrongHeader[1] |= 1;
    assert.throws(() => readBody(wrongHeader), /form/);
    const wrongContinuation = Uint8Array.from(body);
    const lastIdByte = omitted.length - 1;
    wrongContinuation[lastIdByte - 1] = wrongContinuation[lastIdByte];
    assert.throws(() => readBody(wrongContinuation), /continuation/);
  },
);
