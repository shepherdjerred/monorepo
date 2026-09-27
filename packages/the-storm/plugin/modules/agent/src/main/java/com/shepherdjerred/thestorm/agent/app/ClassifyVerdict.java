package com.shepherdjerred.thestorm.agent.app;

import java.util.Optional;

/**
 * The brain's reading of a chat case. The offense id is untrusted: the flow drops anything outside
 * the offense list instead of enforcing it.
 *
 * @param offenseId what it is, for example {@code spam}; empty when clean
 * @param confidence how sure, 0-1
 * @param label what the brain called it, for example {@code spam-burst}
 * @param reasoning why, in the brain's words
 * @param model what decided, for example {@code gpt-6-luna}
 * @param costMicros what the thinking cost, in millionths of a dollar
 */
public record ClassifyVerdict(
    Optional<String> offenseId,
    double confidence,
    String label,
    String reasoning,
    String model,
    long costMicros) {

  public ClassifyVerdict {
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0-1");
    }
    if (label.isBlank()) {
      throw new IllegalArgumentException("label must not be blank");
    }
    if (model.isBlank()) {
      throw new IllegalArgumentException("model must not be blank");
    }
    if (costMicros < 0) {
      throw new IllegalArgumentException("costMicros must not be negative");
    }
  }
}
