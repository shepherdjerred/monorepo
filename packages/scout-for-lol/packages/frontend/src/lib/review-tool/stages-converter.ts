import {
  type PipelineStagesConfig,
  selectRandomStyle,
  TIMELINE_SUMMARY_SYSTEM_PROMPT,
  TIMELINE_SUMMARY_USER_PROMPT,
  MATCH_SUMMARY_SYSTEM_PROMPT,
  MATCH_SUMMARY_USER_PROMPT,
  REVIEW_TEXT_SYSTEM_PROMPT,
  REVIEW_TEXT_USER_PROMPT,
  IMAGE_DESCRIPTION_SYSTEM_PROMPT,
  IMAGE_DESCRIPTION_USER_PROMPT,
  IMAGE_GENERATION_USER_PROMPT,
} from "@scout-for-lol/data";
import type { ReviewConfig } from "./config/schema.ts";

/**
 * Convert frontend stages config to data package format
 *
 * We need to manually rebuild each object to handle exactOptionalPropertyTypes
 * which requires conditional property assignment for optional fields.
 */
export function convertStagesToDataPackageFormat(
  stages: NonNullable<ReviewConfig["stages"]>,
): PipelineStagesConfig {
  // Build timeline summary stage
  const timelineSummaryModel: PipelineStagesConfig["timelineSummary"]["model"] =
    {
      model: stages.timelineSummary.model.model,
      maxTokens: stages.timelineSummary.model.maxTokens,
    };
  if (stages.timelineSummary.model.temperature !== undefined) {
    timelineSummaryModel.temperature = stages.timelineSummary.model.temperature;
  }
  if (stages.timelineSummary.model.topP !== undefined) {
    timelineSummaryModel.topP = stages.timelineSummary.model.topP;
  }
  const timelineSummary: PipelineStagesConfig["timelineSummary"] = {
    enabled: stages.timelineSummary.enabled,
    model: timelineSummaryModel,
    systemPrompt:
      stages.timelineSummary.systemPrompt ?? TIMELINE_SUMMARY_SYSTEM_PROMPT,
    userPrompt:
      stages.timelineSummary.userPrompt ?? TIMELINE_SUMMARY_USER_PROMPT,
  };

  // Build match summary stage
  const matchSummaryModel: PipelineStagesConfig["matchSummary"]["model"] = {
    model: stages.matchSummary.model.model,
    maxTokens: stages.matchSummary.model.maxTokens,
  };
  if (stages.matchSummary.model.temperature !== undefined) {
    matchSummaryModel.temperature = stages.matchSummary.model.temperature;
  }
  if (stages.matchSummary.model.topP !== undefined) {
    matchSummaryModel.topP = stages.matchSummary.model.topP;
  }
  const matchSummary: PipelineStagesConfig["matchSummary"] = {
    enabled: stages.matchSummary.enabled,
    model: matchSummaryModel,
    systemPrompt:
      stages.matchSummary.systemPrompt ?? MATCH_SUMMARY_SYSTEM_PROMPT,
    userPrompt: stages.matchSummary.userPrompt ?? MATCH_SUMMARY_USER_PROMPT,
  };

  // Build review text stage
  const reviewTextModel: PipelineStagesConfig["reviewText"]["model"] = {
    model: stages.reviewText.model.model,
    maxTokens: stages.reviewText.model.maxTokens,
  };
  if (stages.reviewText.model.temperature !== undefined) {
    reviewTextModel.temperature = stages.reviewText.model.temperature;
  }
  if (stages.reviewText.model.topP !== undefined) {
    reviewTextModel.topP = stages.reviewText.model.topP;
  }
  const reviewText: PipelineStagesConfig["reviewText"] = {
    model: reviewTextModel,
    systemPrompt: stages.reviewText.systemPrompt ?? REVIEW_TEXT_SYSTEM_PROMPT,
    userPrompt: stages.reviewText.userPrompt ?? REVIEW_TEXT_USER_PROMPT,
  };

  // Build image description stage
  const imageDescriptionModel: PipelineStagesConfig["imageDescription"]["model"] =
    {
      model: stages.imageDescription.model.model,
      maxTokens: stages.imageDescription.model.maxTokens,
    };
  if (stages.imageDescription.model.temperature !== undefined) {
    imageDescriptionModel.temperature =
      stages.imageDescription.model.temperature;
  }
  if (stages.imageDescription.model.topP !== undefined) {
    imageDescriptionModel.topP = stages.imageDescription.model.topP;
  }
  const imageDescription: PipelineStagesConfig["imageDescription"] = {
    enabled: stages.imageDescription.enabled,
    model: imageDescriptionModel,
    systemPrompt:
      stages.imageDescription.systemPrompt ?? IMAGE_DESCRIPTION_SYSTEM_PROMPT,
    userPrompt:
      stages.imageDescription.userPrompt ?? IMAGE_DESCRIPTION_USER_PROMPT,
  };

  // Build image generation stage
  const imageGeneration: PipelineStagesConfig["imageGeneration"] = {
    enabled: stages.imageGeneration.enabled,
    model: stages.imageGeneration.model,
    timeoutMs: stages.imageGeneration.timeoutMs,
    artStyle: selectRandomStyle(),
    userPrompt:
      stages.imageGeneration.userPrompt ?? IMAGE_GENERATION_USER_PROMPT,
  };

  return {
    timelineSummary,
    matchSummary,
    reviewText,
    imageDescription,
    imageGeneration,
  };
}
