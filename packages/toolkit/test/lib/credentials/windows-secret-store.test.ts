import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createCredentialCache,
  installedToolkitPath,
  liveCredentialCache,
} from "#lib/credential-cache.ts";
import { liveReferenceLockRoot } from "#lib/credential-reads.ts";
import { resolveCredentialValues } from "#lib/credentials.ts";
import {
  createWindowsDpapiSecretStore,
  defaultWindowsSecretsDir,
  sanitizeSecretSegment,
  windowsSecretFilePath,
  type DpapiCodec,
} from "#lib/windows-secret-store.ts";

const FAKE_SA_TOKEN = `ops_eyJ${"W".repeat(160)}`;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "toolkit-win-dpapi-"));
  tempDirs.push(dir);
  return dir;
}

const base64TestCodec: DpapiCodec = {
  protect: (plaintext) =>
    Promise.resolve(Buffer.from(plaintext, "utf8").toString("base64")),
  unprotect: (ciphertext) =>
    Promise.resolve(Buffer.from(ciphertext, "base64").toString("utf8")),
};

describe("Windows DPAPI secret store", () => {
  test("sanitizes secret path segments and rejects traversal", () => {
    expect(sanitizeSecretSegment("my-service.1", "service")).toBe(
      "my-service.1",
    );
    expect(sanitizeSecretSegment("user/name:1", "account")).toBe("user_name_1");
    expect(() => sanitizeSecretSegment("..", "service")).toThrow(
      "invalid Windows secret service",
    );
    expect(() => sanitizeSecretSegment("   ", "account")).toThrow(
      "invalid Windows secret account",
    );
    expect(
      windowsSecretFilePath("C:/secrets", { service: "svc", name: "acct" }),
    ).toBe(path.join("C:/secrets", "svc", "acct.dpapi"));
    expect(
      defaultWindowsSecretsDir(
        { LOCALAPPDATA: "C:/Users/Test/AppData/Local" },
        "C:/Users/Test",
      ),
    ).toBe(path.join("C:/Users/Test/AppData/Local", "toolkit", "secrets"));
  });

  test("round-trips get/set/delete through the injected DPAPI codec", async () => {
    const rootDir = await makeTempDir();
    const store = createWindowsDpapiSecretStore({
      rootDir,
      codec: base64TestCodec,
    });
    const key = { service: "test-service", name: "test-account" };

    expect(await store.get(key)).toBeNull();
    expect(await store.delete(key)).toBe(false);

    await store.set({ ...key, value: "super-secret-value" });
    expect(await store.get(key)).toBe("super-secret-value");

    expect(await store.delete(key)).toBe(true);
    expect(await store.get(key)).toBeNull();
  });

  test("resolves 1Password service-account credentials and workstation secrets on win32", async () => {
    const rootDir = await makeTempDir();
    const configPath = path.join(rootDir, "absent.toml");
    const store = createWindowsDpapiSecretStore({
      rootDir,
      codec: base64TestCodec,
    });
    const username = os.userInfo().username;
    const savedSa = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
    const savedWoodpecker = Bun.env["WOODPECKER_TOKEN"];
    const savedDiscord = Bun.env["DISCORD_BOT_TOKEN"];
    Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
    Reflect.deleteProperty(Bun.env, "WOODPECKER_TOKEN");
    Reflect.deleteProperty(Bun.env, "DISCORD_BOT_TOKEN");

    try {
      const seenCalls: string[][] = [];
      const run = (
        argv: string[],
        extra: Readonly<Record<string, string>> = {},
      ) => {
        seenCalls.push(argv);
        if (
          argv[0] === "op" &&
          extra["OP_SERVICE_ACCOUNT_TOKEN"] === FAKE_SA_TOKEN
        ) {
          return Promise.resolve({
            exit: 0,
            stdout: "woodpecker-from-win-dpapi\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exit: 1, stdout: "", stderr: "unexpected" });
      };

      await expect(
        resolveCredentialValues(["WOODPECKER_TOKEN"], {
          run,
          platform: "win32",
          secretStore: store,
          configPath,
          cache: null,
        }),
      ).rejects.toThrow("pwsh scripts/onepassword/enroll-service-account.ps1");
      expect(seenCalls).toEqual([]);

      await store.set({
        service: "monorepo-homelab-1password-service-account",
        name: username,
        value: FAKE_SA_TOKEN,
      });
      const cache = createCredentialCache({ store, ttlSeconds: 3600 });
      const first = await resolveCredentialValues(["WOODPECKER_TOKEN"], {
        run,
        platform: "win32",
        secretStore: store,
        configPath,
        cache,
      });
      expect(first).toEqual({ WOODPECKER_TOKEN: "woodpecker-from-win-dpapi" });
      expect(seenCalls.length).toBe(1);

      const second = await resolveCredentialValues(["WOODPECKER_TOKEN"], {
        run,
        platform: "win32",
        secretStore: store,
        configPath,
        cache,
      });
      expect(second).toEqual({ WOODPECKER_TOKEN: "woodpecker-from-win-dpapi" });
      expect(seenCalls.length).toBe(1);

      await expect(
        resolveCredentialValues(["DISCORD_BOT_TOKEN"], {
          run,
          platform: "win32",
          secretStore: store,
          configPath,
          cache: null,
        }),
      ).rejects.toThrow(
        "pwsh scripts/onepassword/enroll-workstation-secret.ps1",
      );

      await store.set({
        service: "monorepo-workstation-discord-bot-token",
        name: username,
        value: "discord-bot-from-dpapi",
      });
      const discord = await resolveCredentialValues(["DISCORD_BOT_TOKEN"], {
        run,
        platform: "win32",
        secretStore: store,
        configPath,
        cache: null,
      });
      expect(discord).toEqual({ DISCORD_BOT_TOKEN: "discord-bot-from-dpapi" });
    } finally {
      if (savedSa === undefined) {
        Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
      } else {
        Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = savedSa;
      }
      if (savedWoodpecker === undefined) {
        Reflect.deleteProperty(Bun.env, "WOODPECKER_TOKEN");
      } else {
        Bun.env["WOODPECKER_TOKEN"] = savedWoodpecker;
      }
      if (savedDiscord === undefined) {
        Reflect.deleteProperty(Bun.env, "DISCORD_BOT_TOKEN");
      } else {
        Bun.env["DISCORD_BOT_TOKEN"] = savedDiscord;
      }
    }
  });

  test("resolves Windows paths for installedToolkitPath, liveReferenceLockRoot, and liveCredentialCache", () => {
    expect(installedToolkitPath("win32").endsWith("toolkit.exe")).toBe(true);
    expect(installedToolkitPath("darwin").endsWith("toolkit")).toBe(true);
    expect(
      liveReferenceLockRoot(
        "win32",
        { LOCALAPPDATA: "C:/Users/Test/AppData/Local" },
        "C:/Users/Test",
      ),
    ).toBe(
      path.join("C:/Users/Test/AppData/Local", "toolkit", "credential-locks"),
    );
    expect(liveCredentialCache(3600, "win32")).not.toBeNull();
    expect(liveCredentialCache(0, "win32")).toBeNull();
  });

  test.runIf(process.platform === "win32")(
    "round-trips a real Windows CurrentUser DPAPI payload > 2560 bytes",
    async () => {
      const rootDir = await makeTempDir();
      const store = createWindowsDpapiSecretStore({ rootDir });
      const largeCertLikePayload = `CERT-${"X".repeat(4096)}-END`;
      await store.set({
        service: "toolkit-dpapi-selftest",
        name: "large-item",
        value: largeCertLikePayload,
      });
      expect(
        await store.get({
          service: "toolkit-dpapi-selftest",
          name: "large-item",
        }),
      ).toBe(largeCertLikePayload);
      expect(
        await store.delete({
          service: "toolkit-dpapi-selftest",
          name: "large-item",
        }),
      ).toBe(true);
    },
  );
});
