import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { startSyncFixture } from "./server";
import { syntheticAccount, syntheticVault } from "./contract";
import {
  FixtureSocket,
  login,
  pinnedV3,
  post,
  privateDirectory,
} from "./fixture.test-support";

test("synthetic account requires MFA and validates vault proof and token lifetime", async () => {
  const directory = await privateDirectory();
  const fixture = await startSyncFixture({
    directory,
    runID: crypto.randomUUID(),
  });
  try {
    const credentials = {
      email: syntheticAccount.email,
      password: syntheticAccount.password,
    };
    const challenge = await post(fixture, "/user/signin", {
      ...credentials,
      mfa: "",
    });
    expect(challenge.value).toEqual({ error: "2FA code required" });
    const rejectedCode = await post(fixture, "/user/signin", {
      ...credentials,
      mfa: "000000",
    });
    expect(rejectedCode.value).toEqual({ error: "2FA code is incorrect" });
    const rejectedPassword = await post(fixture, "/user/signin", {
      ...credentials,
      password: "unexpected",
      mfa: "123456",
    });
    expect(rejectedPassword.value).toEqual({
      error: "Fixture account rejected",
    });
    const token = await login(fixture);
    const other = await login(fixture);
    expect(other).not.toBe(token);
    const list = await post(fixture, "/vault/list", {
      token,
      supported_encryption_version: 3,
    });
    expect(list.value).toEqual({
      vaults: [
        {
          id: fixture.identity.vaultID,
          name: syntheticAccount.name,
          host: syntheticVault.host,
          region: "fixture",
          salt: syntheticVault.salt,
          encryption_version: 3,
        },
      ],
      shared: [],
    });
    const access = {
      token,
      vault_uid: fixture.identity.vaultID,
      keyhash: syntheticVault.keyProof,
      host: syntheticVault.host,
      encryption_version: 3,
    };
    expect(await post(fixture, "/vault/access", access)).toEqual({
      status: 200,
      value: {},
    });
    const badProof = await post(fixture, "/vault/access", {
      ...access,
      keyhash: "wrong",
    });
    expect(badProof.status).toBe(400);
    const badShape = await post(fixture, "/vault/list", {
      token,
      supported_encryption_version: 3,
      unexpected: true,
    });
    expect(badShape.status).toBe(400);
    const signedOut = await post(fixture, "/user/signout", { token });
    expect(signedOut.status).toBe(200);
    const expired = await post(fixture, "/user/info", { token });
    expect(expired.status).toBe(400);
    const retained = await post(fixture, "/user/info", { token: other });
    expect(retained.status).toBe(200);
    const wrongRun = await fetch(
      fixture.identity.httpOrigin +
        "/__fixture/state?runID=" +
        crypto.randomUUID(),
    );
    expect(wrongRun.status).toBe(400);
    expect(fixture.snapshot().files).toEqual([]);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true });
  }
});

test("a retained fixture cannot be reopened with another run or while already active", async () => {
  const directory = await privateDirectory();
  const runID = crypto.randomUUID();
  const fixture = await startSyncFixture({ directory, runID });
  try {
    await expect(
      startSyncFixture({ directory, runID: crypto.randomUUID() }),
    ).rejects.toThrow();
    await expect(startSyncFixture({ directory, runID })).rejects.toThrow();
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true });
  }
});

test("native fixture encryption inputs match the independent pinned official vectors", async () => {
  const file = path.resolve(
    import.meta.dir,
    "../../../tasknotes-fixtures/vault/upstream/obsidian-crypto.json",
  );
  const bytes = await Bun.file(file).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    "fc9bd5c007afb74b905297b360dba729d24a63b96b6d0851fd5813be05fc0515",
  );
  const cryptoFixture = z
    .object({
      inputs: z.object({ password: z.string(), salt: z.string() }),
      vectors: z.object({
        cases: z.array(
          z.object({
            version: z.number(),
            keyHashBytes: z.array(z.number().int().min(0).max(255)),
          }),
        ),
      }),
    })
    .parse(JSON.parse(new TextDecoder().decode(bytes)));
  expect(cryptoFixture.inputs).toEqual({
    password: syntheticVault.password,
    salt: syntheticVault.salt,
  });
  const version = cryptoFixture.vectors.cases.find(
    (item) => item.version === 3,
  );
  expect(version).toBeDefined();
  expect(Buffer.from(version?.keyHashBytes ?? []).toString("hex")).toBe(
    syntheticVault.keyProof,
  );
});

test("unbound WebSocket operations close without publishing bytes", async () => {
  const directory = await privateDirectory();
  const fixture = await startSyncFixture({
    directory,
    runID: crypto.randomUUID(),
    profile: "pinned-transcript-v3",
  });
  const socket = await FixtureSocket.open(fixture.identity.webSocketURL);
  try {
    const [init] = await pinnedV3();
    if (init === undefined || !("text" in init))
      throw new Error("Missing pinned init");
    socket.send({ ...init.text, token: "not-a-fixture-token" });
    await socket.closed;
    expect(fixture.snapshot().counters.protocolErrors).toBe(1);
    expect(fixture.snapshot().files).toEqual([]);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true });
  }
});
