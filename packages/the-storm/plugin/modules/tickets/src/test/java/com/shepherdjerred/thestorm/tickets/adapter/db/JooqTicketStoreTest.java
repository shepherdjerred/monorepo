package com.shepherdjerred.thestorm.tickets.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketError;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.TicketLocation;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import com.shepherdjerred.thestorm.tickets.domain.Triage;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqTicketStoreTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;
  private JooqTicketStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("tickets", JooqTicketStoreTest.class.getClassLoader());
    store = new JooqTicketStore(database, "test");
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void ticketsRoundTripWithLocation() throws Exception {
    var draft =
        new TicketDraft(
            ALICE,
            TicketCategory.GRIEF,
            "someone broke my wall",
            Optional.of(new TicketLocation("world", 10, 64, -30)));

    var inserted = store.insert(draft, NOW).get(5, TimeUnit.SECONDS);
    var found = store.find(inserted.id()).get(5, TimeUnit.SECONDS);

    assertThat(inserted.id()).isEqualTo(1);
    assertThat(found).contains(inserted);
    assertThat(found.orElseThrow().location()).contains(new TicketLocation("world", 10, 64, -30));
  }

  @Test
  void serversSeeOnlyTheirOwnTickets() throws Exception {
    var other = new JooqTicketStore(database, "other");
    var mine =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.GRIEF, "grief", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var theirs =
        other
            .insert(new TicketDraft(ALICE, TicketCategory.GRIEF, "grief", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);

    assertThat(mine.server()).isEqualTo("test");
    assertThat(theirs.server()).isEqualTo("other");
    assertThat(store.find(theirs.id()).get(5, TimeUnit.SECONDS)).isEmpty();
    assertThat(store.list(TicketFilter.all()).get(5, TimeUnit.SECONDS)).containsExactly(mine);
    assertThat(other.list(TicketFilter.all()).get(5, TimeUnit.SECONDS)).containsExactly(theirs);
  }

  @Test
  void idsAssignInOrderAcrossRestartsOfTheCounter() throws Exception {
    var first =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.CHAT, "spam", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var second =
        store
            .insert(new TicketDraft(BOB, TicketCategory.THEFT, "stolen", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);

    assertThat(first.id()).isEqualTo(1);
    assertThat(second.id()).isEqualTo(2);
  }

  @Test
  void savingPersistsStatusPriorityAndClaimer() throws Exception {
    var inserted =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.CHEAT, "fly hack", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var claimed =
        switch (inserted.claim(BOB, NOW.plusSeconds(5))) {
          case Result.Ok<Ticket, TicketError>(var ticket) -> ticket;
          case Result.Err<Ticket, TicketError>(var error) ->
              throw new AssertionError("expected claim to succeed, got " + error);
        };

    store.save(claimed).get(5, TimeUnit.SECONDS);

    var found = store.find(inserted.id()).get(5, TimeUnit.SECONDS).orElseThrow();
    assertThat(found.status()).isEqualTo(TicketStatus.CLAIMED);
    assertThat(found.claimer()).contains(BOB);
    assertThat(found.updatedAt()).isEqualTo(NOW.plusSeconds(5));
  }

  @Test
  void listingHonorsTheFilter() throws Exception {
    var first =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.GRIEF, "grief", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var second =
        store
            .insert(new TicketDraft(BOB, TicketCategory.CHAT, "spam", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var claimed =
        switch (second.claim(BOB, NOW)) {
          case Result.Ok<Ticket, TicketError>(var ticket) -> ticket;
          case Result.Err<Ticket, TicketError>(var error) ->
              throw new AssertionError("expected claim to succeed, got " + error);
        };
    store.save(claimed).get(5, TimeUnit.SECONDS);

    assertThat(store.list(TicketFilter.open()).get(5, TimeUnit.SECONDS))
        .extracting(t -> t.id())
        .containsExactly(first.id());
    assertThat(store.list(TicketFilter.claimedBy(BOB)).get(5, TimeUnit.SECONDS))
        .extracting(t -> t.id())
        .containsExactly(second.id());
  }

  @Test
  void commentsRoundTripInOrder() throws Exception {
    var inserted =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.OTHER, "help", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);

    store
        .addComment(inserted.id(), new CommentDraft(ALICE, false, "more detail"), NOW)
        .get(5, TimeUnit.SECONDS);
    store
        .addComment(inserted.id(), new CommentDraft(BOB, true, "staff note"), NOW)
        .get(5, TimeUnit.SECONDS);

    var comments = store.comments(inserted.id()).get(5, TimeUnit.SECONDS);
    assertThat(comments).extracting(c -> c.body()).containsExactly("more detail", "staff note");
    assertThat(comments.get(1).staffOnly()).isTrue();
  }

  @Test
  void triageRoundTripsAndReplaces() throws Exception {
    var inserted =
        store
            .insert(new TicketDraft(ALICE, TicketCategory.GRIEF, "grief", Optional.empty()), NOW)
            .get(5, TimeUnit.SECONDS);
    var first = new Triage(TicketPriority.NORMAL, List.of(), "some damage", "looking into it", NOW);
    var second =
        new Triage(TicketPriority.URGENT, List.of(inserted.id()), "big damage", "on it", NOW);

    store.saveTriage(inserted.id(), first).get(5, TimeUnit.SECONDS);
    assertThat(store.find(inserted.id()).get(5, TimeUnit.SECONDS).orElseThrow().triage())
        .contains(first);

    store.saveTriage(inserted.id(), second).get(5, TimeUnit.SECONDS);
    assertThat(store.find(inserted.id()).get(5, TimeUnit.SECONDS).orElseThrow().triage())
        .contains(second);
  }
}
