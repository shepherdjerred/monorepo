package com.shepherdjerred.thestorm.tickets.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TicketLifecycleTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final UUID BOB = UUID.fromString("22222222-2222-2222-2222-222222222222");
  private static final Instant AT = Instant.parse("2017-06-01T12:00:00Z");

  private static Ticket open() {
    return Ticket.open(
        42,
        new TicketDraft(ALICE, TicketCategory.GRIEF, "someone broke my wall", Optional.empty()),
        AT,
        "test");
  }

  private static <T> T ok(Result<T, TicketError> result) {
    return switch (result) {
      case Result.Ok<T, TicketError>(var value) -> value;
      case Result.Err<T, TicketError>(var error) ->
          throw new AssertionError("expected success, got " + error);
    };
  }

  private static TicketError err(Result<?, TicketError> result) {
    return switch (result) {
      case Result.Ok<?, TicketError>(var value) ->
          throw new AssertionError("expected failure, got " + value);
      case Result.Err<?, TicketError>(var error) -> error;
    };
  }

  @Test
  void newTicketsAreOpenUnclaimedAndNormal() {
    var ticket = open();

    assertThat(ticket.status()).isEqualTo(TicketStatus.OPEN);
    assertThat(ticket.priority()).isEqualTo(TicketPriority.NORMAL);
    assertThat(ticket.claimer()).isEmpty();
    assertThat(ticket.triage()).isEmpty();
    assertThat(ticket.createdAt()).isEqualTo(AT);
    assertThat(ticket.updatedAt()).isEqualTo(AT);
  }

  @Test
  void blankSummariesAreRejected() {
    assertThatThrownBy(() -> new TicketDraft(ALICE, TicketCategory.CHAT, "  ", Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void claimNamesTheClaimer() {
    var claimed = ok(open().claim(BOB, AT.plusSeconds(1)));

    assertThat(claimed.status()).isEqualTo(TicketStatus.CLAIMED);
    assertThat(claimed.claimer()).contains(BOB);
    assertThat(claimed.updatedAt()).isEqualTo(AT.plusSeconds(1));
  }

  @Test
  void resolvedTicketsCannotBeClaimed() {
    var resolved = ok(open().transitionTo(TicketStatus.RESOLVED, AT));

    assertThat(err(resolved.claim(BOB, AT))).isEqualTo(TicketError.ILLEGAL_TRANSITION);
  }

  @Test
  void reopeningClearsTheClaimer() {
    var claimed = ok(open().claim(BOB, AT));
    var reopened = ok(claimed.transitionTo(TicketStatus.OPEN, AT));

    assertThat(reopened.status()).isEqualTo(TicketStatus.OPEN);
    assertThat(reopened.claimer()).isEmpty();
  }

  @Test
  void resolvingKeepsTheLastClaimer() {
    var claimed = ok(open().claim(BOB, AT));
    var resolved = ok(claimed.transitionTo(TicketStatus.RESOLVED, AT));

    assertThat(resolved.claimer()).contains(BOB);
  }

  @Test
  void resolvedTicketsOnlyReopen() {
    var resolved = ok(open().transitionTo(TicketStatus.RESOLVED, AT));

    assertThat(err(resolved.transitionTo(TicketStatus.CLAIMED, AT)))
        .isEqualTo(TicketError.ILLEGAL_TRANSITION);
    assertThat(ok(resolved.transitionTo(TicketStatus.OPEN, AT)).status())
        .isEqualTo(TicketStatus.OPEN);
  }

  @Test
  void triageAdoptsItsPriority() {
    var triage =
        new Triage(
            TicketPriority.URGENT, List.of(7L), "wall blocks missing", "looking into it", AT);
    var triaged = open().withTriage(triage, AT);

    assertThat(triaged.priority()).isEqualTo(TicketPriority.URGENT);
    assertThat(triaged.triage()).contains(triage);
  }

  @Test
  void idsRoundTrip() {
    for (var category : TicketCategory.values()) {
      assertThat(TicketCategory.fromId(category.id())).isEqualTo(category);
    }
    for (var status : TicketStatus.values()) {
      assertThat(TicketStatus.fromId(status.id())).isEqualTo(status);
    }
    for (var priority : TicketPriority.values()) {
      assertThat(TicketPriority.fromId(priority.id())).isEqualTo(priority);
    }
  }

  @Test
  void unknownIdsAreRejected() {
    assertThatThrownBy(() -> TicketCategory.fromId("nope"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TicketStatus.fromId("nope"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TicketPriority.fromId("nope"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
