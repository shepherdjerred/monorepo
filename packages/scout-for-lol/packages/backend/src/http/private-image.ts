import { z } from "zod";
import type { User } from "#generated/prisma/client/index.js";
import { createContext } from "#src/trpc/context.ts";

/**
 * The shared front half of a private image route: support screenshots and
 * Explore attachments are both served only to a signed-in web session, never
 * cached, and addressed by a UUID in the path.
 */

export const PRIVATE_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export type PrivateImageRequest =
  | { readonly kind: "response"; readonly response: Response }
  | { readonly kind: "authorized"; readonly user: User; readonly id: string };

/**
 * Null when the path is not this route's. Otherwise either the response to
 * send now (wrong method, signed out, malformed id) or the signed-in user and
 * the requested id, for the route to look up and serve.
 */
export async function authorizePrivateImageRequest(
  request: Request,
  url: URL,
  path: RegExp,
): Promise<PrivateImageRequest | null> {
  const match = path.exec(url.pathname);
  if (match === null) return null;
  const respond = (body: string, status: number): PrivateImageRequest => ({
    kind: "response",
    response: new Response(body, { status, headers: PRIVATE_IMAGE_HEADERS }),
  });
  if (request.method !== "GET") return respond("Method not allowed", 405);
  const ctx = await createContext(request);
  if (ctx.user === null || ctx.webSession === null)
    return respond("Sign in required", 401);
  const id = z.uuid().safeParse(match[1]);
  return id.success
    ? { kind: "authorized", user: ctx.user, id: id.data }
    : respond("Not found", 404);
}
