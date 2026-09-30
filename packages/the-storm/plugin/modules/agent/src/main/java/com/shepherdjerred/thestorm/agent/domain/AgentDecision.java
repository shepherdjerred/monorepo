package com.shepherdjerred.thestorm.agent.domain;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * One decision the agent made, as the record of it. Overturns and endorsements arrive later,
 * through {@link #withOverturned} and {@link #withEndorsed}.
 */
public record AgentDecision(
    long id,
    Instant at,
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
    String note,
    Optional<UUID> overturnedBy,
    Optional<Instant> overturnedAt,
    Optional<UUID> endorsedBy,
    Optional<Instant> endorsedAt,
    String server) {

  /** The longest classification and model kept. */
  public static final int MAX_LABEL_LENGTH = 200;

  /** The longest note kept. */
  public static final int MAX_NOTE_LENGTH = 2000;

  public AgentDecision {
    if (classification.isBlank() || classification.length() > MAX_LABEL_LENGTH) {
      throw new IllegalArgumentException(
          "classification must be 1-" + MAX_LABEL_LENGTH + " characters");
    }
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0-1");
    }
    if (model.isBlank() || model.length() > MAX_LABEL_LENGTH) {
      throw new IllegalArgumentException("model must be 1-" + MAX_LABEL_LENGTH + " characters");
    }
    if (costMicros < 0) {
      throw new IllegalArgumentException("costMicros must not be negative");
    }
    if (note.length() > MAX_NOTE_LENGTH) {
      throw new IllegalArgumentException("note must be at most " + MAX_NOTE_LENGTH + " characters");
    }
    if (overturnedBy.isPresent() != overturnedAt.isPresent()) {
      throw new IllegalArgumentException("overturn needs both a reviewer and a time");
    }
    if (endorsedBy.isPresent() != endorsedAt.isPresent()) {
      throw new IllegalArgumentException("endorsement needs both a reviewer and a time");
    }
    if (server.isBlank()) {
      throw new IllegalArgumentException("server must not be blank");
    }
  }

  /** This decision overturned by {@code staff} at {@code at}. */
  public AgentDecision withOverturned(UUID staff, Instant at) {
    return new AgentDecision(
        id,
        this.at,
        player,
        offense,
        ticketId,
        classification,
        confidence,
        model,
        action,
        shadow,
        sampled,
        ladderStep,
        costMicros,
        note,
        Optional.of(staff),
        Optional.of(at),
        endorsedBy,
        endorsedAt,
        server);
  }

  /** This decision endorsed by {@code staff} at {@code at}. */
  public AgentDecision withEndorsed(UUID staff, Instant at) {
    return new AgentDecision(
        id,
        this.at,
        player,
        offense,
        ticketId,
        classification,
        confidence,
        model,
        action,
        shadow,
        sampled,
        ladderStep,
        costMicros,
        note,
        overturnedBy,
        overturnedAt,
        Optional.of(staff),
        Optional.of(at),
        server);
  }
}
