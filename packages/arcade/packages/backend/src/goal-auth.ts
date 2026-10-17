import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const SubscriptionAuthSchema = z.object({
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1),
    refresh_token: z.string().min(1),
  }),
});

/** Codex SDK uses the CLI's auth cache for ChatGPT subscription credentials. */
export async function prepareGoalAuth(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const encoded = z.base64().safeParse(environment["CODEX_AUTH_JSON_B64"]);
  if (!encoded.success)
    throw new Error("Emerald goals require CODEX_AUTH_JSON_B64");
  const contents = Buffer.from(encoded.data, "base64").toString("utf8");
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!SubscriptionAuthSchema.safeParse(parsed).success)
      throw new Error("Invalid subscription authentication");
  } catch {
    // JSON and schema errors can include credentials. Keep this boundary opaque.
    throw new Error("Invalid Emerald subscription authentication");
  }
  const home = await mkdtemp(path.join(tmpdir(), "arcade-codex-"));
  try {
    await writeFile(path.join(home, "auth.json"), contents, {
      mode: 0o600,
      flag: "wx",
    });
    return home;
  } catch (error) {
    await rm(home, { recursive: true });
    throw error;
  }
}
