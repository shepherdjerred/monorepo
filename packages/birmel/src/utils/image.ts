import type { Attachment, Message } from "discord.js";
import { logger } from "./logger.ts";

export type ImageAttachment = {
  id: string;
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
export function isImageAttachment(
  attachment: Pick<Attachment, "contentType">,
): boolean {
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
        id: attachment.id,
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

export type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A_MAGIC = Buffer.from("GIF87a");
const GIF89A_MAGIC = Buffer.from("GIF89a");
const RIFF_MAGIC = Buffer.from("RIFF");
const WEBP_MAGIC = Buffer.from("WEBP");

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC);
}

function isGif(buffer: Buffer): boolean {
  if (buffer.length < 6) {
    return false;
  }
  const prefix = buffer.subarray(0, 6);
  return prefix.equals(GIF87A_MAGIC) || prefix.equals(GIF89A_MAGIC);
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_MAGIC) &&
    buffer.subarray(8, 12).equals(WEBP_MAGIC)
  );
}

function sniffImageContentType(buffer: Buffer): string | undefined {
  if (isPng(buffer)) {
    return "image/png";
  }
  if (isJpeg(buffer)) {
    return "image/jpeg";
  }
  if (isGif(buffer)) {
    return "image/gif";
  }
  if (isWebp(buffer)) {
    return "image/webp";
  }
  return undefined;
}

function validateImageSize(size: number): void {
  if (size > MAX_IMAGE_SIZE) {
    throw new Error(
      `Image too large: ${String(size)} bytes (max ${String(MAX_IMAGE_SIZE)})`,
    );
  }
}

function resolveDownloadedContentType(
  headerContentType: string | null,
  buffer: Buffer,
): string {
  const normalized = headerContentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized != null && SUPPORTED_IMAGE_TYPES.has(normalized)) {
    return normalized === "image/jpg" ? "image/jpeg" : normalized;
  }

  const sniffed = sniffImageContentType(buffer);
  if (sniffed != null) {
    return sniffed;
  }

  throw new Error(
    `Unsupported image type: received ${normalized ?? "unknown"}`,
  );
}

function getAbortMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return "Operation aborted";
}

/**
 * Download an image from a URL with timeout and size limit
 */
export async function downloadImage(
  url: string,
  signal?: AbortSignal,
): Promise<DownloadedImage> {
  const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const combinedSignal =
    signal == null ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);

  try {
    const response = await fetch(url, {
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)}: ${response.statusText}`,
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength != null && contentLength.length > 0) {
      validateImageSize(Number.parseInt(contentLength, 10));
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    validateImageSize(buffer.length);

    const contentType = resolveDownloadedContentType(
      response.headers.get("content-type"),
      buffer,
    );

    logger.debug("Image downloaded successfully", {
      url,
      contentType,
      size: buffer.length,
    });

    return { buffer, contentType };
  } catch (error) {
    if (combinedSignal.aborted) {
      if (signal?.aborted === true) {
        throw new Error(getAbortMessage(signal.reason), { cause: error });
      }
      throw new Error("Image download timeout", { cause: error });
    }

    throw error;
  }
}

/**
 * Download an image with retry logic
 */
export async function downloadImageWithRetry(
  url: string,
  signal?: AbortSignal,
): Promise<DownloadedImage> {
  try {
    return await downloadImage(url, signal);
  } catch (error) {
    if (signal?.aborted === true) {
      throw new Error(getAbortMessage(signal.reason), { cause: error });
    }
    logger.warn("Image download failed, retrying once", { url, error });
    // Retry once
    return await downloadImage(url, signal);
  }
}
