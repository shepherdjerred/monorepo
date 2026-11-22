import type { RedditOutreachReason } from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";

export const redditOutreachReasonLabels = {
  "listing-ineligible": "Listing ineligible",
  "already-handled": "Already handled",
  "rules-exclude-replies": "Community rules exclude replies",
  "thread-ineligible": "Thread ineligible",
  "intent-unconfirmed": "Server search intent unconfirmed",
  "permission-unconfirmed": "Community permission unconfirmed",
  "requirements-unconfirmed": "Server requirements unmet or unclear",
  "score-too-low": "Fit score missed threshold",
  "decision-declined": "Other qualification rejection",
  "draft-rejected": "Draft rejected",
  "publish-blocked": "Publish blocked",
  "publish-duplicate": "Duplicate at publishing",
  "publish-deferred": "Publish deferred",
  "publish-verified": "Verified during the sweep",
} satisfies Record<RedditOutreachReason, string>;
