package com.shepherdjerred.thestorm.tickets.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * A ticket as other modules see it: every field as JDK types, enums as their ids. Snapshots are
 * taken after the write succeeds, so agent decisions built on them never see half-written state.
 *
 * @param id the ticket id
 * @param reporter who filed it
 * @param categoryId what it is about, for example {@code grief}
 * @param statusId where it sits, for example {@code open}
 * @param priorityId how urgently it needs attention, for example {@code urgent}
 * @param summary what happened, in the reporter's words
 * @param location where it happened, when captured
 * @param createdAt when it was filed
 * @param updatedAt when it last changed
 * @param claimer who owns it, when claimed
 * @param triage the agent's working of it, once triaged
 * @param server which server it belongs to
 */
public record TicketSnapshot(
    long id,
    UUID reporter,
    String categoryId,
    String statusId,
    String priorityId,
    String summary,
    Optional<LocationSnapshot> location,
    Instant createdAt,
    Instant updatedAt,
    Optional<UUID> claimer,
    Optional<TriageSnapshot> triage,
    String server) {}
