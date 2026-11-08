import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

export const RIOT_LINK_COOKIE = "scout_riot_link";
export const RIOT_LINK_TTL_SECONDS = 300;
const AUDIENCE = "scout-riot-account-link";
const FlowSchema = z.object({
  state: z.string().length(64),
  verifier: z.string().min(43).max(128),
  nonce: z.string().length(64),
});
export type RiotLinkFlow = z.infer<typeof FlowSchema>;

export function newRiotLinkFlow(): RiotLinkFlow {
  return {
    state: randomBytes(32).toString("hex"),
    nonce: randomBytes(32).toString("hex"),
    verifier: randomBytes(32).toString("base64url"),
  };
}

function key(secret: string): Uint8Array {
  if (secret.length < 32)
    throw new Error("Riot linking requires the session signing secret");
  return createHash("sha256").update(`${AUDIENCE}:${secret}`).digest();
}

export async function encryptRiotLinkFlow(
  flow: RiotLinkFlow,
  secret: string,
): Promise<string> {
  return new EncryptJWT(flow)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("scout-for-lol")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${RIOT_LINK_TTL_SECONDS.toString()}s`)
    .encrypt(key(secret));
}

export async function decryptRiotLinkFlow(
  cookie: string | undefined,
  secret: string,
): Promise<RiotLinkFlow | null> {
  if (cookie === undefined) return null;
  const decryptionKey = key(secret);
  try {
    const { payload } = await jwtDecrypt(cookie, decryptionKey, {
      issuer: "scout-for-lol",
      audience: AUDIENCE,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    return FlowSchema.parse(payload);
  } catch {
    return null;
  }
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
