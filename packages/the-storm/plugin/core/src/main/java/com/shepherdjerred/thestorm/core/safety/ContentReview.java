package com.shepherdjerred.thestorm.core.safety;

import java.util.Set;

/** A publication verdict, never a ban recommendation. */
public record ContentReview(
    String decision,
    String category,
    double confidence,
    String reason,
    String model,
    long costMicros,
    int muteSeconds,
    java.util.Map<String, Double> scores,
    boolean screened) {
  public ContentReview {
    scores = java.util.Map.copyOf(scores);
    if (scores.values().stream()
        .anyMatch(score -> !Double.isFinite(score) || score < 0 || score > 1))
      throw new IllegalArgumentException("Invalid moderation scores");
    if (!Set.of("allow", "block", "review").contains(decision)
        || !Set.of("none", "hate", "harassment", "threat", "advertising", "spam").contains(category)
        || !Double.isFinite(confidence)
        || confidence < 0
        || confidence > 1
        || reason.isBlank()
        || model.isBlank()
        || costMicros < 0
        || !Set.of(0, 600, 3600).contains(muteSeconds))
      throw new IllegalArgumentException("Invalid content verdict");
  }

  public boolean allowed() {
    return decision.equals("allow");
  }

  public ContentReview withoutScreening() {
    return new ContentReview(
        decision, category, confidence, reason, model, costMicros, muteSeconds, scores, false);
  }
}
