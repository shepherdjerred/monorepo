-- Server-side record of the one-time feedback prompt.
--
-- Dismissal lived only in localStorage, so the same account was re-prompted on
-- another device, in a private window, or after clearing site data — breaking
-- the "we'll only ask you once" promise in the dialog and skewing the sample.
CREATE TABLE "FeedbackPromptState" (
  "discordId" TEXT NOT NULL PRIMARY KEY,
  "dismissedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted" BOOLEAN NOT NULL DEFAULT false
);
