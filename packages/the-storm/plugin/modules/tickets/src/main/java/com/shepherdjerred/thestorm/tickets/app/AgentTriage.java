package com.shepherdjerred.thestorm.tickets.app;

import java.util.List;

/**
 * A triage from outside the module, with ids as strings. The service validates every field; the
 * agent's brain output is untrusted.
 *
 * @param priorityId the suggested priority, for example {@code urgent}
 * @param duplicateIds likely-duplicate ticket ids, least-recent first
 * @param evidence the evidence-pack summary
 * @param draftReply the proposed reply to the reporter
 */
public record AgentTriage(
    String priorityId, List<Long> duplicateIds, String evidence, String draftReply) {}
