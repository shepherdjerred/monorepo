package com.shepherdjerred.thestorm.tickets.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketLocation;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;

final class TicketViewsTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final UUID BOB = UUID.fromString("22222222-2222-2222-2222-222222222222");
  private static final Instant AT = Instant.parse("2017-06-01T12:00:00Z");

  private static String text(net.kyori.adventure.text.Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  private static java.util.function.Function<java.util.UUID, String> names() {
    var known = Map.of(ALICE, "Alice", BOB, "Bob");
    return id -> known.getOrDefault(id, "?");
  }

  private static Ticket ticket() {
    return new Ticket(
        42,
        ALICE,
        TicketCategory.GRIEF,
        TicketStatus.CLAIMED,
        TicketPriority.URGENT,
        "someone broke my wall",
        Optional.of(new TicketLocation("world", 10, 64, -30)),
        AT,
        AT,
        Optional.of(BOB),
        Optional.empty(),
        "test");
  }

  @Test
  void queueLineSummarizesTheTicket() {
    var line = text(TicketViews.queueLine(ticket(), names()));

    assertThat(line).contains("#42");
    assertThat(line).contains("claimed");
    assertThat(line).contains("urgent");
    assertThat(line).contains("grief");
    assertThat(line).contains("Alice");
    assertThat(line).contains("someone broke my wall");
  }

  @Test
  void reportersSeeEverythingButStaffNotes() {
    var comments =
        List.of(
            new TicketComment(1, ALICE, false, "more detail", AT),
            new TicketComment(2, BOB, true, "staff note", AT));

    var shown = text(TicketViews.detail(ticket(), comments, names(), false));

    assertThat(shown).contains("Ticket #42");
    assertThat(shown).contains("world 10 64 -30");
    assertThat(shown).contains("more detail");
    assertThat(shown).doesNotContain("staff note");
  }

  @Test
  void staffSeeStaffNotes() {
    var comments = List.of(new TicketComment(2, BOB, true, "staff note", AT));

    var shown = text(TicketViews.detail(ticket(), comments, names(), true));

    assertThat(shown).contains("staff note");
  }
}
