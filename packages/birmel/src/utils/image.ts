import type { Attachment, Message } from "discord.js";
import { logger } from "./logger.js";

export type ImageAttachment = {
  url: string;
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
};

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const DOWNLOAD_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Check if an attachment is a supported image type
 */
export function isImageAttachment(attachment: Attachment): boolean {
  if (attachment.contentType == null || attachment.contentType.length === 0) {
    return false;
  }
  return SUPPORTED_IMAGE_TYPES.has(attachment.contentType.toLowerCase());
}

/**
 * Extract image attachments from a Discord message
 */
export function extractImageAttachments(message: Message): ImageAttachment[] {
  const images: ImageAttachment[] = [];

  for (const attachment of message.attachments.values()) {
    if (isImageAttachment(attachment)) {
      images.push({
        url: attachment.url,
        filename: attachment.name,
        contentType: attachment.contentType ?? "image/png",
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
      });
    }
  }

  return images;
}

/**
 * Download an image from a URL with timeout and retry logic
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)}: ${response.statusText}`,
      );
    }

    const contentLength = response.headers.get("content-length");
    if (
      contentLength != null &&
      contentLength.length > 0 &&
      Number.parseInt(contentLength) > MAX_IMAGE_SIZE
    ) {
      throw new Error(
        `Image too large: ${String(Number.parseInt(contentLength))} bytes (max ${String(MAX_IMAGE_SIZE)})`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image too large: ${String(buffer.length)} bytes (max ${String(MAX_IMAGE_SIZE)})`,
      );
    }

    logger.debug("Image downloaded successfully", {
      url,
      size: buffer.length,
    });

    return buffer;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Image download timeout");
    }

    throw error;
  }
}

/**
 * Download an image with retry logic
 */
export async function downloadImageWithRetry(url: string): Promise<Buffer> {
  try {
    return await downloadImage(url);
  } catch (error) {
    logger.warn("Image download failed, retrying once", { url, error });
    // Retry once
    return await downloadImage(url);
  }
}
