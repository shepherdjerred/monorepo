import { timingSafeEqual, createHash } from "node:crypto";
import type { Principal } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { RuntimeConfig } from "./config.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export async function authenticate(
  request: Request,
  peerAddress: string | null,
  config: RuntimeConfig,
): Promise<Principal> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    if (!authorization.startsWith("Bearer "))
      throw new DeliveryError("UNAUTHORIZED", "Bearer authentication required");
    const supplied = digest(authorization.slice(7));
    const matches = config.machineCredentials.filter((entry) =>
      timingSafeEqual(supplied, digest(entry.token)),
    );
    if (matches.length !== 1)
      throw new DeliveryError("UNAUTHORIZED", "Invalid machine credential");
    const credential = matches[0];
    if (credential === undefined)
      throw new Error("Matched credential disappeared");
    return credential.principal;
  }
  const trusted = await config.trustedProxyAddresses();
  if (peerAddress === null || !trusted.includes(peerAddress))
    throw new DeliveryError(
      "UNAUTHORIZED",
      "Authenticated private ingress required",
    );
  const login = request.headers.get("tailscale-user-login");
  const operators = await config.operatorLogins();
  if (login === null || !operators.includes(login))
    throw new DeliveryError("FORBIDDEN", "Operator identity is not authorized");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== new URL(config.publicOrigin).origin)
      throw new DeliveryError(
        "FORBIDDEN",
        "Same-origin browser request required",
      );
  }
  return { id: login, kind: "human", scopes: ["read", "deploy", "approve"] };
}
export function requireScope(
  principal: Principal,
  scope: Principal["scopes"][number],
) {
  if (!principal.scopes.includes(scope))
    throw new DeliveryError(
      "FORBIDDEN",
      `Credential lacks ${scope} permission`,
    );
  if (scope === "approve" && principal.kind !== "human")
    throw new DeliveryError(
      "FORBIDDEN",
      "Machine credentials cannot approve releases",
    );
}
