import type { MessageContext } from "../../discord/events/message-create.js";
import { downloadImageWithRetry } from "../../utils/image.js";
import { logger } from "../../utils/logger.js";

export type TextPart = {
  type: "text";
  text: string;
};

export type ImagePart = {
  type: "image";
  image: Buffer;
  mimeType?: string;
  contentType?: string;
};

export type MessageContent = string | (TextPart | ImagePart)[];

/**
 * Build message content for the agent, including images if present
 */
export async function buildMessageContent(
  context: MessageContext,
  prompt: string,
): Promise<MessageContent> {
  // If no images, return plain text
  if (context.attachments.length === 0) {
    return prompt;
  }

  const content: (TextPart | ImagePart)[] = [
    { type: "text", text: prompt },
  ];

  // Add up to 5 images (to avoid token limits)
  const imagesToProcess = context.attachments.slice(0, 5);

  for (const attachment of imagesToProcess) {
    try {
      logger.debug("Downloading image for vision analysis", {
        url: attachment.url,
        filename: attachment.filename,
        size: attachment.size,
      });

      const imageBuffer = await downloadImageWithRetry(attachment.url);

      content.push({
        type: "image",
        image: imageBuffer,
        mimeType: attachment.contentType,
        contentType: attachment.contentType,
      });

      logger.debug("Image added to message content", {
        filename: attachment.filename,
        bufferSize: imageBuffer.length,
      });
    } catch (error) {
      logger.warn("Failed to download image, skipping", {
        url: attachment.url,
        filename: attachment.filename,
        error,
      });
    }
  }

  return content;
}
