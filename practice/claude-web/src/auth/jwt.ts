import * as jose from "jose";
import { getConfig } from "../config/index.js";
import type { JWTPayload } from "./types.js";

const ALGORITHM = "HS256";
const ISSUER = "claude-web";
const EXPIRATION = "7d";

function getSecretKey(): Uint8Array {
  const config = getConfig();
  return new TextEncoder().encode(config.JWT_SECRET);
}

export async function signToken(payload: JWTPayload): Promise<string> {
  const secret = getSecretKey();

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(EXPIRATION)
    .sign(secret);

  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getSecretKey();

    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    });

    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
