import assert from "node:assert/strict";
import { z } from "zod";
import {
  ControlSchema,
  syntheticAccount,
  syntheticVault,
  type fixtureProfile,
} from "./contract";
import type { FixtureStore } from "./store";

const TokenSchema = z.strictObject({ token: z.string().min(1).max(256) });
const LoginSchema = z.strictObject({
  email: z.string().max(256),
  password: z.string().max(4096),
  mfa: z.string().max(256),
});
const AccessSchema = TokenSchema.extend({
  vault_uid: z.string(),
  keyhash: z.string(),
  host: z.string(),
  encryption_version: z.literal(3),
});
const json = (value: unknown, status = 200) => Response.json(value, { status });

export function createFixtureHTTP(options: {
  store: FixtureStore;
  settings: ReturnType<typeof fixtureProfile>;
  runID: string;
  inventory: () => unknown;
  control: (action: z.infer<typeof ControlSchema>["action"]) => void;
}) {
  const { store, settings } = options;
  const token = (body: unknown) => {
    const session = TokenSchema.parse(body);
    assert.ok(store.validToken(session.token));
    return session.token;
  };
  const routes: Record<string, (body: unknown) => Response> = {
    "/__fixture/control": (body) => {
      const control = ControlSchema.parse(body);
      assert.equal(control.runID, options.runID);
      options.control(control.action);
      return json({ ok: true });
    },
    "/user/signin": (body) => {
      const login = LoginSchema.parse(body);
      if (
        login.email !== syntheticAccount.email ||
        login.password !== syntheticAccount.password
      )
        return json({ error: "Fixture account rejected" });
      if (login.mfa === "") return json({ error: "2FA code required" });
      if (login.mfa !== syntheticAccount.verificationCode)
        return json({ error: "2FA code is incorrect" });
      return json({
        token: store.newToken(),
        name: syntheticAccount.name,
        email: syntheticAccount.email,
      });
    },
    "/vault/list": (body) => {
      const list = TokenSchema.extend({
        supported_encryption_version: z.literal(3),
      }).parse(body);
      assert.ok(store.validToken(list.token));
      return json({
        vaults: [
          {
            id: settings.vaultID,
            name: syntheticAccount.name,
            host: syntheticVault.host,
            region: "fixture",
            salt: syntheticVault.salt,
            encryption_version: 3,
          },
        ],
        shared: [],
      });
    },
    "/vault/access": (body) => {
      const access = AccessSchema.parse(body);
      assert.ok(store.validToken(access.token));
      assert.equal(access.vault_uid, settings.vaultID);
      assert.equal(access.keyhash, settings.keyProof);
      assert.equal(access.host, syntheticVault.host);
      return json({});
    },
    "/user/info": (body) => {
      token(body);
      return json({
        name: syntheticAccount.name,
        email: syntheticAccount.email,
      });
    },
    "/user/signout": (body) => {
      store.signOut(token(body));
      return json({});
    },
  };
  return async (
    request: Request,
    upgrade: () => boolean,
  ): Promise<Response | undefined> => {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/sync")
        return upgrade()
          ? undefined
          : json({ error: "WebSocket upgrade required" }, 400);
      if (request.method === "GET" && url.pathname === "/__fixture/state") {
        assert.equal(url.searchParams.get("runID"), options.runID);
        return json(options.inventory());
      }
      if (request.method === "OPTIONS" && url.pathname === "/user/signin")
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "https://obsidian.md",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      const route = routes[url.pathname];
      if (route === undefined || request.method !== "POST")
        return json({ error: "Unsupported fixture operation" }, 404);
      const body: unknown = await request.json();
      return route(body);
    } catch {
      return json({ error: "Fixture request rejected" }, 400);
    }
  };
}
