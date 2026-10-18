import { z } from "zod";

async function inspectPrincipal(token: string): Promise<unknown> {
  const response = await fetch(
    "https://argocd.sjer.red/api/v1/session/userinfo",
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error("Cannot independently verify bootstrap Argo principal");
  return response.json();
}

/** Explicit one-time operator authority never becomes a runtime or root-release credential fallback. */
export async function bootstrapCredentials(inspect = inspectPrincipal) {
  const operator = z.string().min(1).parse(Bun.env["ARGOCD_TOKEN"]);
  const root = z.string().min(1).parse(Bun.env["ROOT_ARGOCD_TOKEN"]);
  z.object({ loggedIn: z.literal(true), username: z.literal("admin") }).parse(
    await inspect(operator),
  );
  z.object({
    loggedIn: z.literal(true),
    username: z.enum(["woodpecker", "delivery-platform"]),
  }).parse(await inspect(root));
  return { ARGOCD_TOKEN: root };
}
