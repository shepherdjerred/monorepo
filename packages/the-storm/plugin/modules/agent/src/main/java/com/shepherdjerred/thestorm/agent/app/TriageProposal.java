package com.shepherdjerred.thestorm.agent.app;

import java.util.List;

/**
 * The brain's working of a ticket. Ids are untrusted: the service rejects unknown priorities, and
 * resolution needs its own higher confidence bar.
 *
 * @param priorityId the suggested priority, for example {@code urgent}
 * @param confidence how sure, 0-1
 * @param duplicates likely-duplicate ticket ids, least-recent first
 * @param evidence the evidence-pack summary
 * @param draftReply the proposed reply to the reporter
 * @param resolve whether the ticket can be closed with the reply
 * @param resolutionNote the public closing note, when resolving
 * @param model what decided, for example {@code gpt-6-luna}
 * @param costMicros what the thinking cost, in millionths of a dollar
 */
public record TriageProposal(
    String priorityId,
    double confidence,
    List<Long> duplicates,
    String evidence,
    String draftReply,
    boolean resolve,
    String resolutionNote,
    String model,
    long costMicros) {

  public TriageProposal {
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0-1");
    }
    if (model.isBlank()) {
      throw new IllegalArgumentException("model must not be blank");
    }
    if (costMicros < 0) {
      throw new IllegalArgumentException("costMicros must not be negative");
    }
  }
}
