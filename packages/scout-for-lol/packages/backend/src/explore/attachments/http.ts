import { prisma } from "#src/database/index.ts";
import { readExploreAttachment } from "#src/explore/attachments/storage.ts";
import { createLogger } from "#src/logger.ts";
import {
  authorizePrivateImageRequest,
  PRIVATE_IMAGE_HEADERS,
} from "#src/http/private-image.ts";

const logger = createLogger("explore-attachment");

const PATH = /^\/api\/explore\/attachments\/([^/]+)$/;

/**
 * Serve an attached image to the person who attached it.
 *
 * Private like support screenshots: no cache, sniffing off, and a sandbox
 * CSP so the bytes can never run as a document. Anyone else, and anyone
 * signed out, gets the same 404/401 an absent image would.
 */
export async function handleExploreAttachment(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const authorized = await authorizePrivateImageRequest(request, url, PATH);
  if (authorized === null) return null;
  if (authorized.kind === "response") return authorized.response;
  const headers = PRIVATE_IMAGE_HEADERS;
  const row = await prisma.exploreAttachment.findFirst({
    where: { id: authorized.id, ownerId: authorized.user.discordId },
  });
  if (row === null) return new Response("Not found", { status: 404, headers });
  try {
    const image = await readExploreAttachment(row);
    return new Response(Buffer.from(image.bytes), {
      headers: {
        ...headers,
        "Content-Type": image.mediaType,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    logger.warn("Explore attachment could not be served", {
      attachmentId: row.id,
    });
    return new Response("Image temporarily unavailable", {
      status: 503,
      headers,
    });
  }
}
