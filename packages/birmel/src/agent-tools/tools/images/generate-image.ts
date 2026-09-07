import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import {
  getRequestContext,
  stageAttachment,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { downloadImageWithRetry } from "@shepherdjerred/birmel/utils/image.ts";
import { sanitizeUrlForLogging } from "@shepherdjerred/birmel/utils/safe-url.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { generateImage } from "ai";
import { z } from "zod";

const logger = loggers.tools.child("generate-image");

const AspectRatioSchema = z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const GenerateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "Detailed visual prompt describing the desired image to generate, or describing edits/modifications to make to the reference image.",
    ),
  aspectRatio: AspectRatioSchema.optional().describe(
    "Aspect ratio for the generated image (default 1:1).",
  ),
  referenceImageUrl: z
    .url()
    .optional()
    .describe(
      "Optional explicit external image URL provided by the user in message text. For user uploads or replied-to messages, leave this omitted so the tool automatically uses the reference image from turn context.",
    ),
});

export const GenerateImageOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  prompt: z.string().optional(),
  aspectRatio: z.string().optional(),
});

export const generateImageTool = createTool({
  id: "generate-image",
  description:
    "Generate a new image or edit/tweak an existing image (from an attachment or reply) using Google's Gemini 3 Pro Image model. The resulting image will be automatically attached to your Discord reply.",
  inputSchema: GenerateImageInputSchema,
  outputSchema: GenerateImageOutputSchema,
  execute: async (input, { signal }) => {
    try {
      signal.throwIfAborted();
      const config = getConfig();

      if (!config.imageGeneration.enabled) {
        return {
          success: false,
          message: "Image generation is disabled in configuration",
        };
      }

      const runtime = getLlmRuntime();
      const imageModel = config.openRouter.imageModel;
      const requestContext = getRequestContext();

      if (
        input.referenceImageUrl == null &&
        (requestContext?.sourceImageAttachments == null ||
          requestContext.sourceImageAttachments.length === 0) &&
        requestContext?.referenceResolutionError != null
      ) {
        return {
          success: false,
          message: `Cannot edit image: failed to resolve referenced message ${requestContext.referenceResolutionError.referencedMessageId} (${requestContext.referenceResolutionError.error})`,
        };
      }
      const resolvedReference =
        input.referenceImageUrl == null
          ? (requestContext?.sourceImageAttachments?.[0] ?? undefined)
          : { url: input.referenceImageUrl, contentType: undefined };

      let files:
        | [
            {
              type: "data";
              data: Uint8Array;
              mediaType: string;
            },
          ]
        | undefined;

      if (resolvedReference != null) {
        logger.debug("Downloading reference image for image editing", {
          url: sanitizeUrlForLogging(resolvedReference.url),
        });
        const downloaded = await downloadImageWithRetry(
          resolvedReference.url,
          signal,
        );
        const mediaType =
          resolvedReference.contentType ?? downloaded.contentType;
        files = [
          {
            type: "data",
            data: new Uint8Array(downloaded.buffer),
            mediaType,
          },
        ];
      }

      const { headers } = runtime.callOptions({
        workload: "birmel.agent.image-generation",
      });

      const result = await generateImage({
        model: runtime.imageModel(imageModel),
        prompt: input.prompt,
        ...(input.aspectRatio == null
          ? {}
          : { aspectRatio: input.aspectRatio }),
        ...(files == null ? {} : { files }),
        headers,
        abortSignal: signal,
      });

      const imageBuffer = Buffer.from(result.image.base64, "base64");
      const filename = `birmel-${String(Date.now())}.png`;

      stageAttachment({
        data: imageBuffer,
        name: filename,
        description: input.prompt.slice(0, 1024),
        contentType: "image/png",
      });

      logger.info("Image generated and staged for reply delivery", {
        model: imageModel,
        aspectRatio: input.aspectRatio ?? "1:1",
        hasReferenceImage: files != null,
        sizeBytes: imageBuffer.length,
      });

      return {
        success: true,
        message: "Image successfully generated and staged for delivery.",
        prompt: input.prompt,
        ...(input.aspectRatio == null
          ? {}
          : { aspectRatio: input.aspectRatio }),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Image generation failed", error, {
        promptLength: input.prompt.length,
        aspectRatio: input.aspectRatio,
        hasReferenceImage: input.referenceImageUrl != null,
      });
      return {
        success: false,
        message: `Image generation failed: ${errorMessage}`,
      };
    }
  },
});
