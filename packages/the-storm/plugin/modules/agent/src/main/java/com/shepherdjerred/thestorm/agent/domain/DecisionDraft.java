package com.shepherdjerred.thestorm.agent.domain;

import java.util.Optional;
import java.util.UUID;

/**
 * A decision being recorded, before it has an id.
 *
 * @param player who it concerns
 * @param offense what they did
 * @param ticketId the ticket behind it, when there is one
 * @param classification what the agent called it, for example {@code spam-burst}
 * @param confidence how sure, 0-1
 * @param model what decided, for example {@code gpt-5.6-luna}
 * @param action what the agent did
 * @param shadow whether the agent only watched: decided and logged, acted nothing
 * @param sampled whether the decision joins the spot-check queue
 * @param ladderStep the rung acted on, when a ladder put it there
 * @param costMicros what the thinking cost, in millionths of a dollar
 * @param note why, in the agent's words
 */
public record DecisionDraft(
    UUID player,
    Offense offense,
    Optional<Long> ticketId,
    String classification,
    double confidence,
    String model,
    DecisionAction action,
    boolean shadow,
    boolean sampled,
    Optional<Integer> ladderStep,
    long costMicros,
    String note) {
  public DecisionDraft {
    if (classification.isBlank() || classification.length() > AgentDecision.MAX_LABEL_LENGTH) {
      throw new IllegalArgumentException(
          "classification must be 1-" + AgentDecision.MAX_LABEL_LENGTH + " characters");
    }
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0-1");
    }
    if (model.isBlank() || model.length() > AgentDecision.MAX_LABEL_LENGTH) {
      throw new IllegalArgumentException(
          "model must be 1-" + AgentDecision.MAX_LABEL_LENGTH + " characters");
    }
    if (costMicros < 0) {
      throw new IllegalArgumentException("costMicros must not be negative");
    }
    if (note.length() > AgentDecision.MAX_NOTE_LENGTH) {
      throw new IllegalArgumentException(
          "note must be at most " + AgentDecision.MAX_NOTE_LENGTH + " characters");
    }
  }
}
