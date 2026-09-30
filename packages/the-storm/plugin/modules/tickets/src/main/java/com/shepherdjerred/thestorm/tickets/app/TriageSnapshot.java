package com.shepherdjerred.thestorm.tickets.app;

import java.time.Instant;
import java.util.List;

/**
 * The agent's working of a ticket, as other modules see it.
 *
 * @param priorityId the suggested priority, for example {@code urgent}
 * @param duplicateIds likely-duplicate ticket ids, least-recent first
 * @param evidence the evidence-pack summary
 * @param draftReply the proposed reply to the reporter
 * @param at when the triage ran
 */
public record TriageSnapshot(
    String priorityId, List<Long> duplicateIds, String evidence, String draftReply, Instant at) {}
