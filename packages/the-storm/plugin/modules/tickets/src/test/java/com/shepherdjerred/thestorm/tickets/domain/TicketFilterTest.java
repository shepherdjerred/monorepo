package com.shepherdjerred.thestorm.tickets.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TicketFilterTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final UUID BOB = UUID.fromString("22222222-2222-2222-2222-222222222222");
  private static final Instant AT = Instant.parse("2017-06-01T12:00:00Z");

  private static Ticket ticket(
      TicketStatus status, TicketPriority priority, Optional<UUID> claimer) {
    return new Ticket(
        1,
        ALICE,
        TicketCategory.GRIEF,
        status,
        priority,
        "broken wall",
        Optional.empty(),
        AT,
        AT,
        claimer,
        Optional.empty(),
        "test");
  }

  @Test
  void openQueueListsOnlyOpenTickets() {
    var filter = TicketFilter.open();

    assertThat(filter.matches(ticket(TicketStatus.OPEN, TicketPriority.LOW, Optional.empty())))
        .isTrue();
    assertThat(filter.matches(ticket(TicketStatus.CLAIMED, TicketPriority.LOW, Optional.of(BOB))))
        .isFalse();
    assertThat(filter.matches(ticket(TicketStatus.RESOLVED, TicketPriority.LOW, Optional.of(BOB))))
        .isFalse();
  }

  @Test
  void claimedByListsOnlyThatStaffsTickets() {
    var filter = TicketFilter.claimedBy(BOB);

    assertThat(filter.matches(ticket(TicketStatus.CLAIMED, TicketPriority.LOW, Optional.of(BOB))))
        .isTrue();
    assertThat(filter.matches(ticket(TicketStatus.CLAIMED, TicketPriority.LOW, Optional.of(ALICE))))
        .isFalse();
    assertThat(filter.matches(ticket(TicketStatus.OPEN, TicketPriority.LOW, Optional.empty())))
        .isFalse();
  }

  @Test
  void unclaimedListsOnlyTicketsNobodyOwns() {
    var filter = TicketFilter.unclaimed();

    assertThat(filter.matches(ticket(TicketStatus.OPEN, TicketPriority.LOW, Optional.empty())))
        .isTrue();
    assertThat(filter.matches(ticket(TicketStatus.ESCALATED, TicketPriority.LOW, Optional.empty())))
        .isTrue();
    assertThat(filter.matches(ticket(TicketStatus.CLAIMED, TicketPriority.LOW, Optional.of(BOB))))
        .isFalse();
  }

  @Test
  void filedByListsOnlyThatPlayersTickets() {
    var filter = TicketFilter.filedBy(ALICE);

    assertThat(
            filter.matches(
                new Ticket(
                    1,
                    ALICE,
                    TicketCategory.GRIEF,
                    TicketStatus.OPEN,
                    TicketPriority.LOW,
                    "broken wall",
                    Optional.empty(),
                    AT,
                    AT,
                    Optional.empty(),
                    Optional.empty(),
                    "test")))
        .isTrue();
    assertThat(
            filter.matches(
                new Ticket(
                    2,
                    BOB,
                    TicketCategory.GRIEF,
                    TicketStatus.OPEN,
                    TicketPriority.LOW,
                    "broken wall",
                    Optional.empty(),
                    AT,
                    AT,
                    Optional.empty(),
                    Optional.empty(),
                    "test")))
        .isFalse();
  }

  @Test
  void urgentListsUnresolvedTicketsAtOrAbove() {
    var filter = TicketFilter.urgent(TicketPriority.NORMAL);

    assertThat(filter.matches(ticket(TicketStatus.OPEN, TicketPriority.URGENT, Optional.empty())))
        .isTrue();
    assertThat(filter.matches(ticket(TicketStatus.OPEN, TicketPriority.LOW, Optional.empty())))
        .isFalse();
    assertThat(
            filter.matches(ticket(TicketStatus.RESOLVED, TicketPriority.URGENT, Optional.of(BOB))))
        .isFalse();
  }
}
