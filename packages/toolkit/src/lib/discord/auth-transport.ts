import { Client } from "discord.js-selfbot-v13";
import { z } from "zod";

type Endpoint = {
  post: (options: {
    auth: false;
    versioned: true;
    data: unknown;
  }) => Promise<unknown>;
};
const ApiNode = z.custom<object>(
  (value) =>
    (typeof value === "object" && value !== null) ||
    typeof value === "function",
);
function authenticationEndpoint(api: unknown, path: string[]): Endpoint {
  let node: unknown = api;
  for (const part of path) node = Reflect.get(ApiNode.parse(node), part);
  return z
    .custom<Endpoint>(
      (value) =>
        typeof Reflect.get(ApiNode.parse(value), "post") === "function",
    )
    .parse(node);
}

/** Use the SDK's HTTP session and client context for the two login endpoints. */
export function discordAuthenticationTransport() {
  const client = new Client({ retryLimit: 0, restRequestTimeout: 30_000 });
  const login = authenticationEndpoint(client.api, ["auth", "login"]);
  const totp = authenticationEndpoint(client.api, ["auth", "mfa", "totp"]);
  return {
    request: async (url: string, init: RequestInit): Promise<Response> => {
      const endpoint =
        url === "https://discord.com/api/v9/auth/login"
          ? login
          : url === "https://discord.com/api/v9/auth/mfa/totp"
            ? totp
            : undefined;
      if (
        endpoint === undefined ||
        init.method !== "POST" ||
        typeof init.body !== "string"
      )
        throw new Error("Unsupported Discord authentication request");
      const data: unknown = JSON.parse(init.body);
      return Response.json(
        await endpoint.post({ auth: false, versioned: true, data }),
      );
    },
    close: () => {
      client.destroy();
    },
  };
}
