import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("jwt");

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = "scout-for-lol";
const AUDIENCE = "scout-for-lol-web";
const SCHEMA_VERSION = 1;

export const SessionClaimsSchema = z.object({
  sub: z.string(),
  iss: z.literal(ISSUER),
  aud: z.literal(AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string(),
  ver: z.literal(SCHEMA_VERSION),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

function getKey(): Uint8Array {
  const secret = configuration.jwtSigningSecret;
  if (secret === undefined || secret.length < 32) {
    throw new Error(
      "JWT_SIGNING_SECRET is missing or shorter than 32 chars — refusing to sign sessions",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(params: {
  discordId: string;
  ttlSeconds?: number;
}): Promise<{ jwt: string; expiresAt: Date }> {
  const ttl = params.ttlSeconds ?? SESSION_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const jti = globalThis.crypto.randomUUID();

  const jwt = await new SignJWT({ ver: SCHEMA_VERSION } satisfies JWTPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(params.discordId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(getKey());

  return { jwt, expiresAt: new Date(exp * 1000) };
}

export async function verifySession(
  jwt: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(jwt, getKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return SessionClaimsSchema.parse(payload);
  } catch (error) {
    logger.debug("JWT verification failed", { error });
    return null;
  }
}
