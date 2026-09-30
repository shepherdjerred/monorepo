package com.shepherdjerred.thestorm.agent.domain;

/**
 * The deterministic pre-filter limits, from {@code agent.yml}. Pre-filters answer the obvious cases
 * without spending brain calls: floods, invites, bursts, and repeats act directly, while caps,
 * links, and shouting go to the brain for a second look.
 *
 * @param maxLines how many lines per player per window pass before the rate trip fires
 * @param windowSeconds the rate and repeat window
 * @param maxLength the longest message that is not a flood
 * @param maxRepeats how many identical messages per player per window pass
 * @param capsMinLength the shortest message the caps signal considers
 * @param capsPercent the uppercase share, 1-100, that sends a message to the brain
 */
public record PrefilterLimits(
    int maxLines,
    int windowSeconds,
    int maxLength,
    int maxRepeats,
    int capsMinLength,
    int capsPercent) {

  public PrefilterLimits {
    if (maxLines < 1) {
      throw new IllegalArgumentException("maxLines must be positive");
    }
    if (windowSeconds < 1) {
      throw new IllegalArgumentException("windowSeconds must be positive");
    }
    if (maxLength < 1) {
      throw new IllegalArgumentException("maxLength must be positive");
    }
    if (maxRepeats < 1) {
      throw new IllegalArgumentException("maxRepeats must be positive");
    }
    if (capsMinLength < 1) {
      throw new IllegalArgumentException("capsMinLength must be positive");
    }
    if (capsPercent < 1 || capsPercent > 100) {
      throw new IllegalArgumentException("capsPercent must be 1-100");
    }
  }
}
