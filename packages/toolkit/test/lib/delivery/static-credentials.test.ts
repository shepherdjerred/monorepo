import { expect, test, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  CREDENTIAL_REGISTRY,
  resolveCredentials,
  type CredentialRun,
} from "#lib/credentials.ts";

test("manual static recovery brokers the exact activator and six-zone purge items, refusing an empty purge field despite a broad ambient token", async () => {
  const vault = "op://v64ocnykdqju4ui6j6pua56xw4";
  const activator = "l5c76kuxgqckt3xc7pmman6l4u";
  const purge = "la7gkfl5eqtxiiv2hq3qujx2gi";
  const refs = {
    DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID: `${vault}/${activator}/DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID`,
    DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY: `${vault}/${activator}/DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY`,
    CLOUDFLARE_API_TOKEN: `${vault}/${purge}/credential`,
  };
  const names = Object.keys(refs);
  const managed = [...names, "CF_API_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN"];
  const saved = new Map(managed.map((name) => [name, Bun.env[name]]));
  const messages: string[] = [];
  const log = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    });
  const calls: string[][] = [];
  let provisioned = false;
  const run: CredentialRun = (argv) => {
    calls.push(argv);
    expect(argv.slice(0, 2)).toEqual(["op", "read"]);
    expect(Object.values(refs)).toContain(argv[2]);
    return Promise.resolve({
      exit: 0,
      stderr: "",
      stdout:
        !provisioned && argv[2] === refs.CLOUDFLARE_API_TOKEN
          ? ""
          : "synthetic-scoped-value",
    });
  };
  try {
    for (const name of names) Reflect.deleteProperty(Bun.env, name);
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "synthetic-service-account";
    Bun.env["CF_API_TOKEN"] = "synthetic-broad-token-must-not-fallback";
    for (const [name, ref] of Object.entries(refs))
      expect(CREDENTIAL_REGISTRY[name]?.source).toEqual({ kind: "op", ref });
    expect(CREDENTIAL_REGISTRY["CLOUDFLARE_API_TOKEN"]?.source).not.toEqual(
      CREDENTIAL_REGISTRY["CF_API_TOKEN"]?.source,
    );
    const deps = {
      run,
      configPath: path.join(
        os.tmpdir(),
        `absent-toolkit-config-${crypto.randomUUID()}`,
      ),
    };
    await expect(
      resolveCredentials(["CLOUDFLARE_API_TOKEN"], deps),
    ).rejects.toThrow("CLOUDFLARE_API_TOKEN");
    expect(Bun.env["CLOUDFLARE_API_TOKEN"]).toBeUndefined();
    provisioned = true;
    await resolveCredentials(names, deps);
    expect(calls.map((argv) => argv[2])).toEqual([
      refs.CLOUDFLARE_API_TOKEN,
      ...Object.values(refs),
    ]);
    for (const name of names)
      expect(Bun.env[name]).toBe("synthetic-scoped-value");
    expect(messages.join("\n")).not.toContain("synthetic-scoped-value");
  } finally {
    log.mockRestore();
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(Bun.env, name);
      else Bun.env[name] = value;
    }
  }
});
