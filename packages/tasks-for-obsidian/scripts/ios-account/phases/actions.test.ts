import { expect, test } from "vitest";
import { authenticateOnly } from "./authentication";
import { connectOnly } from "./connection";
import { parseIosVaultOptions } from "../../ios-account";

test("connect-only CLI accepts no account locators or Desktop vault backend", () => {
  const reference =
    "op://" + "a".repeat(26) + "/" + "b".repeat(26) + "/password";
  expect(
    parseIosVaultOptions(["--vault-password-ref", reference])
      .vaultPasswordBackend,
  ).toBe("service-account");
  expect(() =>
    parseIosVaultOptions([
      "--vault-password-ref",
      reference,
      "--account",
      "a".repeat(26),
    ]),
  ).toThrow();
  expect(() =>
    parseIosVaultOptions([
      "--vault-password-ref",
      reference,
      "--vault-password-backend",
      "desktop",
    ]),
  ).toThrow();
});

function vaultClient(stage = "vaults", managed = false) {
  const events: string[] = [];
  const client = {
    stage,
    canConnectWithoutPassword: managed,
    fillVaultPassword: async () => {
      events.push("fill-vault");
    },
    connect: async () => {
      events.push("connect");
    },
    observe: async () => {
      client.stage = "connected";
      events.push("observe");
    },
    finish: async () => {
      events.push("finish");
      return { submitActionCount: 1 };
    },
  };
  // These fixed values are public fixtures; no real backend is called.
  let admissions = 0;
  const dependencies = {
    admit: async () => {
      events.push("admit");
      admissions++;
      return { accountExchange: "stable" };
    },
    readVaultPassword: () => {
      events.push("vault-read");
      return "public-vault-fixture";
    },
    connected: async () => ({
      profiles: [{ profileID: "12345678-1234-4234-9234-123456789abc" }],
    }),
  };
  return { client, dependencies, events, admissions: () => admissions };
}
test.each(["credentials", "verification"])(
  "connect-only rejects initial %s before any read",
  async (stage) => {
    const f = vaultClient(stage);
    await expect(
      connectOnly(f.client, "owned-vault", undefined, f.dependencies),
    ).rejects.toThrow();
    expect(f.events).toEqual([]);
  },
);
test("connect-only fails an initial owner gate before vault-password read", async () => {
  const f = vaultClient();
  f.dependencies.admit = async () => {
    throw new Error("public owner rejection");
  };
  await expect(
    connectOnly(f.client, "owned-vault", undefined, f.dependencies),
  ).rejects.toThrow();
  expect(f.events).toEqual([]);
});
test("post-read owner change never fills or submits and never rereads", async () => {
  const f = vaultClient();
  let gates = 0;
  f.dependencies.admit = async () => {
    if (++gates === 2) throw new Error("public owner rejection");
    return {};
  };
  await expect(
    connectOnly(f.client, "owned-vault", undefined, f.dependencies),
  ).rejects.toThrow();
  expect(f.events).toEqual(["vault-read"]);
});
test.each([false, true])(
  "managed=%s connection has one normal submit and no authentication capability",
  async (managed) => {
    const f = vaultClient("vaults", managed);
    const receipt = await connectOnly(
      f.client,
      "owned-vault",
      undefined,
      f.dependencies,
    );
    expect(receipt.submitActionCount).toBe(1);
    expect(f.events.filter((x) => x === "connect")).toHaveLength(1);
    expect(f.events.filter((x) => x === "vault-read")).toHaveLength(
      managed ? 0 : 1,
    );
    expect(f.events.slice(-3)).toEqual(["connect", "observe", "finish"]);
  },
);
test("auth-only refuses an already-restored vault form without account or OTP reads", async () => {
  let reads = 0;
  const client = {
    stage: "vaults" as const,
    fill: async () => ({
      disabledCheckpoints: 2 as const,
      signInEnabled: true as const,
      submitActionCount: 0 as const,
    }),
    submit: async () => ({ submitActionCount: 1 as const }),
    observe: async () => ({ stage: "vaults" as const, connectEnabled: false }),
    fillVerification: async () => {
      throw new Error("Unexpected verification fill");
    },
    submitVerification: async () => {
      throw new Error("Unexpected verification submit");
    },
    finish: async () => ({ submitActionCount: 0 }),
  };
  await expect(
    authenticateOnly(client, {
      validate: async () => ({}),
      readAccount: () => {
        reads++;
        return { email: "fixture@example.invalid", password: "public-fixture" };
      },
      verification: () => {
        reads++;
        throw new Error("must not read OTP");
      },
    }),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
