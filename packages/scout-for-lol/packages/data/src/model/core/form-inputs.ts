import { z } from "zod";

/** Shared human-entered player name used by every player administration flow. */
export const PlayerAliasSchema = z
  .string()
  .trim()
  .min(1, "Enter a player name.")
  .max(100, "Player names must be 100 characters or fewer.");

/** Free-form product feedback persisted by the feedback router. */
export const FeedbackBodySchema = z
  .string()
  .trim()
  .min(1, "Enter your feedback.")
  .max(4000, "Feedback must be 4,000 characters or fewer.");

export const ReportTitleSchema = z
  .string()
  .trim()
  .min(1, "Enter a report title.")
  .max(100, "Report titles must be 100 characters or fewer.");

export const ReportDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Report descriptions must be 500 characters or fewer.");

export const CompetitionTitleSchema = z
  .string()
  .trim()
  .min(1, "Enter a competition title.")
  .max(100, "Competition titles must be 100 characters or fewer.");

export const CompetitionDescriptionSchema = z
  .string()
  .trim()
  .min(1, "Enter a competition description.")
  .max(500, "Competition descriptions must be 500 characters or fewer.");

export const CompetitionMaxParticipantsSchema = z
  .number()
  .int("Maximum participants must be a whole number.")
  .min(2, "A competition needs at least two participants.")
  .max(100, "Competitions support at most 100 participants.");
