package com.shepherdjerred.thestorm.tickets.domain;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Which tickets a queue lists.
 *
 * @param statuses the statuses included; empty means all
 * @param claimer only tickets claimed by this staff member, when present
 * @param reporter only tickets filed by this player, when present
 * @param onlyUnclaimed only tickets nobody claimed
 * @param minPriority only tickets at least this urgent
 */
public record TicketFilter(
    Set<TicketStatus> statuses,
    Optional<UUID> claimer,
    Optional<UUID> reporter,
    boolean onlyUnclaimed,
    TicketPriority minPriority) {

  public TicketFilter {
    statuses = statuses.isEmpty() ? statuses : EnumSet.copyOf(statuses);
  }

  /** Every ticket. */
  public static TicketFilter all() {
    return new TicketFilter(
        Set.of(), Optional.empty(), Optional.empty(), false, TicketPriority.LOW);
  }

  /** Tickets waiting for anyone. */
  public static TicketFilter open() {
    return new TicketFilter(
        EnumSet.of(TicketStatus.OPEN),
        Optional.empty(),
        Optional.empty(),
        false,
        TicketPriority.LOW);
  }

  /** Tickets {@code staff} claimed. */
  public static TicketFilter claimedBy(UUID staff) {
    return new TicketFilter(
        Set.of(), Optional.of(staff), Optional.empty(), false, TicketPriority.LOW);
  }

  /** Tickets {@code player} filed. */
  public static TicketFilter filedBy(UUID player) {
    return new TicketFilter(
        Set.of(), Optional.empty(), Optional.of(player), false, TicketPriority.LOW);
  }

  /** Tickets nobody claimed. */
  public static TicketFilter unclaimed() {
    return new TicketFilter(Set.of(), Optional.empty(), Optional.empty(), true, TicketPriority.LOW);
  }

  /** Unresolved tickets at least {@code min}. */
  public static TicketFilter urgent(TicketPriority min) {
    return new TicketFilter(
        EnumSet.of(TicketStatus.OPEN, TicketStatus.CLAIMED, TicketStatus.ESCALATED),
        Optional.empty(),
        Optional.empty(),
        false,
        min);
  }

  /** Whether {@code ticket} belongs in this queue. */
  public boolean matches(Ticket ticket) {
    if (!statuses.isEmpty() && !statuses.contains(ticket.status())) {
      return false;
    }
    if (claimer.isPresent() && !claimer.equals(ticket.claimer())) {
      return false;
    }
    if (reporter.isPresent() && !reporter.get().equals(ticket.reporter())) {
      return false;
    }
    if (onlyUnclaimed && ticket.claimer().isPresent()) {
      return false;
    }
    return ticket.priority().atLeast(minPriority);
  }
}
