import { z } from "zod";
import { createContext } from "#src/trpc/context.ts";
import { prisma } from "#src/database/index.ts";
import { isScoutOperator } from "#src/operations/operator-allowlist.ts";
import {
  readScreenshot,
  validateScreenshot,
} from "#src/support/screenshots.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("support-screenshot");

export async function handleSupportScreenshot(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const match = /^\/api\/support\/screenshots\/([^/]+)$/.exec(url.pathname);
  if (match === null) return null;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return new Response("Method not allowed", { status: 405, headers });
  const ctx = await createContext(request);
  if (ctx.user === null || ctx.webSession === null)
    return new Response("Sign in required", { status: 401, headers });
  const id = z.uuid().safeParse(match[1]);
  if (!id.success) return new Response("Not found", { status: 404, headers });
  const file = await prisma.supportAttachment.findFirst({
    where: {
      id: id.data,
      status: "STORED",
      ...(isScoutOperator(ctx.user.discordId)
        ? {}
        : { conversation: { discordId: ctx.user.discordId } }),
    },
  });
  if (file === null) return new Response("Not found", { status: 404, headers });
  try {
    const bytes = await readScreenshot(file.objectKey);
    validateScreenshot(bytes, file.contentType);
    if (
      bytes.length !== file.size ||
      file.digest === null ||
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.digest
    )
      throw new Error("Stored screenshot integrity mismatch");
    return new Response(Buffer.from(bytes), {
      headers: {
        ...headers,
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    logger.warn("Private screenshot could not be served", {
      attachmentId: file.id,
    });
    return new Response("Screenshot temporarily unavailable", {
      status: 503,
      headers,
    });
  }
}
