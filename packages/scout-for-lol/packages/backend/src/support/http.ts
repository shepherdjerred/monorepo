import {
  authorizePrivateImageRequest,
  PRIVATE_IMAGE_HEADERS,
} from "#src/http/private-image.ts";
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
  const authorized = await authorizePrivateImageRequest(
    request,
    url,
    /^\/api\/support\/screenshots\/([^/]+)$/,
  );
  if (authorized === null) return null;
  if (authorized.kind === "response") return authorized.response;
  const headers = PRIVATE_IMAGE_HEADERS;
  const { user } = authorized;
  const file = await prisma.supportAttachment.findFirst({
    where: {
      id: authorized.id,
      status: "STORED",
      ...(isScoutOperator(user.discordId)
        ? {}
        : { conversation: { discordId: user.discordId } }),
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
