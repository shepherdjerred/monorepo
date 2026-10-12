import { Spectrum, text } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { z } from "zod/v4";

const CredentialsSchema = z.strictObject({
  projectId: z.string().min(1),
  projectSecret: z.string().min(1),
  webhookSecret: z.string().min(1),
});
export function photonCredentials() {
  const projectId = Bun.env["SPECTRUM_PROJECT_ID"];
  const projectSecret = Bun.env["SPECTRUM_PROJECT_SECRET"];
  const webhookSecret = Bun.env["SPECTRUM_WEBHOOK_SECRET"];
  if (
    [projectId, projectSecret, webhookSecret].every(
      (value) => value === undefined || value === "",
    )
  )
    return;
  // Partial bootstrap is a deployment error, never silently disabled ingress.
  return CredentialsSchema.parse({ projectId, projectSecret, webhookSecret });
}

async function connect() {
  const credentials = photonCredentials();
  if (credentials === undefined)
    throw new Error("Photon credentials are required for delivery");
  return await Spectrum({
    projectId: credentials.projectId,
    projectSecret: credentials.projectSecret,
    providers: [imessage.config()],
    telemetry: false,
    options: { logLevel: "error" },
  });
}
let connection: ReturnType<typeof connect> | undefined;
async function connectOnce() {
  try {
    return await connect();
  } catch (error: unknown) {
    connection = undefined;
    throw error;
  }
}
export async function sendPhotonText(
  spaceId: string,
  linePhone: string,
  content: string,
): Promise<string> {
  connection ??= connectOnce();
  const app = await connection;
  const space = await imessage(app).space.get(spaceId, { phone: linePhone });
  if (space.id !== spaceId || space.type !== "dm")
    throw new Error(
      "Photon delivery space does not match its admitted direct message",
    );
  const sent = await space.send(
    text(content === "" ? "(Agent returned no text.)" : content),
  );
  if (sent === undefined)
    throw new Error("Photon text delivery returned no message receipt");
  return sent.id;
}
export async function closePhotonClient(): Promise<void> {
  const current = connection;
  connection = undefined;
  if (current !== undefined) {
    const app = await current;
    await app.stop();
  }
}
