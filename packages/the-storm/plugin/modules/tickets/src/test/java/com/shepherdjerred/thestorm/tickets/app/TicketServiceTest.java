package com.shepherdjerred.thestorm.tickets.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketError;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import com.shepherdjerred.thestorm.tickets.domain.Triage;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

final class TicketServiceTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final UUID BOB = UUID.fromString("22222222-2222-2222-2222-222222222222");

  /** An instant source tests move by hand. */
  static final class Clock implements InstantSource {

    private Instant now = Instant.parse("2017-06-01T12:00:00Z");

    @Override
    public Instant instant() {
      return now;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  /** A store backed by maps, assigning ids in insertion order. */
  static final class MemoryStore implements TicketStore {

    private final Map<Long, Ticket> tickets = new HashMap<>();
    private final Map<Long, List<TicketComment>> comments = new HashMap<>();
    private long nextTicket = 1;
    private long nextComment = 1;

    @Override
    public CompletableFuture<Ticket> insert(TicketDraft draft, Instant at) {
      var ticket = Ticket.open(nextTicket++, draft, at, "test");
      tickets.put(ticket.id(), ticket);
      return CompletableFuture.completedFuture(ticket);
    }

    @Override
    public CompletableFuture<Optional<Ticket>> find(long id) {
      return CompletableFuture.completedFuture(Optional.ofNullable(tickets.get(id)));
    }

    @Override
    public CompletableFuture<List<Ticket>> list(TicketFilter filter) {
      return CompletableFuture.completedFuture(
          tickets.values().stream()
              .filter(filter::matches)
              .sorted((left, right) -> Long.compare(left.id(), right.id()))
              .toList());
    }

    @Override
    public CompletableFuture<Void> save(Ticket ticket) {
      tickets.put(ticket.id(), ticket);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<TicketComment> addComment(
        long ticketId, CommentDraft draft, Instant at) {
      var comment =
          new TicketComment(nextComment++, draft.author(), draft.staffOnly(), draft.body(), at);
      comments.computeIfAbsent(ticketId, id -> new ArrayList<>()).add(comment);
      return CompletableFuture.completedFuture(comment);
    }

    @Override
    public CompletableFuture<List<TicketComment>> comments(long ticketId) {
      return CompletableFuture.completedFuture(
          List.copyOf(comments.getOrDefault(ticketId, List.of())));
    }

    @Override
    public CompletableFuture<Void> saveTriage(long ticketId, Triage triage) {
      var ticket = tickets.get(ticketId);
      if (ticket != null) {
        tickets.put(ticketId, ticket.withTriage(triage, triage.at()));
      }
      return CompletableFuture.completedFuture(null);
    }
  }

  private final Clock clock = new Clock();
  private final MemoryStore store = new MemoryStore();
  private final List<TicketEvent> events = new ArrayList<>();
  private final TicketService service = new TicketService(store, clock);
  private final Consumer<TicketEvent> listener = events::add;

  {
    service.addListener(listener);
  }

  private static TicketDraft draft() {
    return new TicketDraft(ALICE, TicketCategory.GRIEF, "someone broke my wall", Optional.empty());
  }

  private static <T> T ok(Result<T, TicketError> result) {
    return switch (result) {
      case Result.Ok<T, TicketError>(var value) -> value;
      case Result.Err<T, TicketError>(var error) ->
          throw new AssertionError("expected success, got " + error);
    };
  }

  @Test
  void openingAssignsIdsInOrder() {
    var first = service.open(draft()).join();
    var second = service.open(draft()).join();

    assertThat(first.id()).isEqualTo(1);
    assertThat(second.id()).isEqualTo(2);
    assertThat(service.get(1).join()).contains(first);
  }

  @Test
  void missingTicketsFailLookupsAndEdits() {
    assertThat(service.get(99).join()).isEmpty();
    assertThat(
            service.transition(99, TicketStatus.RESOLVED).join()
                instanceof Result.Err<Ticket, TicketError>)
        .isTrue();
  }

  @Test
  void claimingResolvingAndReopeningFlow() {
    var opened = service.open(draft()).join();

    var claimed = ok(service.claim(opened.id(), BOB).join());
    assertThat(claimed.status()).isEqualTo(TicketStatus.CLAIMED);

    var resolved = ok(service.transition(opened.id(), TicketStatus.RESOLVED).join());
    assertThat(resolved.status()).isEqualTo(TicketStatus.RESOLVED);

    var reopened = ok(service.transition(opened.id(), TicketStatus.OPEN).join());
    assertThat(reopened.status()).isEqualTo(TicketStatus.OPEN);
    assertThat(reopened.claimer()).isEmpty();
  }

  @Test
  void illegalTransitionsLeaveTheTicketAlone() {
    var opened = service.open(draft()).join();
    ok(service.transition(opened.id(), TicketStatus.RESOLVED).join());

    var result = service.claim(opened.id(), BOB).join();

    assertThat(result instanceof Result.Err<Ticket, TicketError>).isTrue();
    assertThat(service.get(opened.id()).join().orElseThrow().status())
        .isEqualTo(TicketStatus.RESOLVED);
  }

  @Test
  void commentsLandOnTheTicketInOrder() {
    var opened = service.open(draft()).join();

    ok(service.comment(opened.id(), new CommentDraft(ALICE, false, "more detail")).join());
    ok(service.comment(opened.id(), new CommentDraft(BOB, true, "staff note")).join());

    var bodies = service.comments(opened.id()).join().stream().map(TicketComment::body).toList();
    assertThat(bodies).containsExactly("more detail", "staff note");
  }

  @Test
  void triageAttachesAndAdoptsPriority() {
    var opened = service.open(draft()).join();
    var triage =
        new Triage(
            TicketPriority.URGENT,
            List.of(),
            "wall blocks missing",
            "looking into it",
            clock.instant());

    var triaged = ok(service.triage(opened.id(), triage).join());

    assertThat(triaged.priority()).isEqualTo(TicketPriority.URGENT);
    assertThat(service.get(opened.id()).join().orElseThrow().triage()).contains(triage);
  }

  @Test
  void changesEmitEventsInOrder() {
    var opened = service.open(draft()).join();
    ok(service.claim(opened.id(), BOB).join());
    ok(service.transition(opened.id(), TicketStatus.RESOLVED).join());

    assertThat(events)
        .extracting(event -> event.ticket().id())
        .containsExactly(opened.id(), opened.id(), opened.id());
    assertThat(events.stream().map(Object::getClass).toList())
        .containsExactly(
            TicketEvent.Opened.class, TicketEvent.Claimed.class, TicketEvent.Resolved.class);
  }

  @Test
  void listingHonorsTheFilter() {
    var first = service.open(draft()).join();
    var second = service.open(draft()).join();
    ok(service.claim(second.id(), BOB).join());
    clock.advance(Duration.ofSeconds(1));

    assertThat(service.list(TicketFilter.open()).join()).containsExactly(first);
    assertThat(service.list(TicketFilter.claimedBy(BOB)).join().stream().map(Ticket::id))
        .containsExactly(second.id());
  }

  @Test
  void removedListenersHearNothing() {
    service.removeListener(listener);
    var opened = service.open(draft()).join();

    assertThat(opened.id()).isEqualTo(1);
    assertThat(events).isEmpty();
  }

  @Test
  void snapshotsCarryIdsNotEnums() {
    var opened = service.open(draft()).join();
    ok(service.comment(opened.id(), new CommentDraft(ALICE, true, "staff note")).join());

    var snapshot = service.snapshot(opened.id()).join().orElseThrow();
    assertThat(snapshot.categoryId()).isEqualTo("grief");
    assertThat(snapshot.statusId()).isEqualTo("open");
    assertThat(snapshot.priorityId()).isEqualTo("normal");
    assertThat(service.commentSnapshots(opened.id()).join())
        .extracting(CommentSnapshot::body)
        .containsExactly("staff note");
    assertThat(service.snapshot(404).join()).isEmpty();
  }

  @Test
  void agentReportsFileAsTheSystemReporter() {
    var opened = agentOk(service.openAgentReport("chat", "spam burst in global").join());

    assertThat(opened.reporter()).isEqualTo(TicketService.SYSTEM_REPORTER);
    assertThat(opened.categoryId()).isEqualTo("chat");
    assertThat(events.stream().map(Object::getClass).toList())
        .containsExactly(TicketEvent.Opened.class);
  }

  @Test
  void agentReportsRejectBadInput() {
    assertThat(service.openAgentReport("littering", "x").join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
    assertThat(service.openAgentReport("chat", "  ").join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
  }

  @Test
  void agentCommentsRejectMissingTicketsAndBadBodies() {
    var opened = agentOk(service.openAgentReport("chat", "spam burst in global").join());

    assertThat(agentOk(service.addAgentComment(opened.id(), "evidence", true).join()).body())
        .isEqualTo("evidence");
    assertThat(service.addAgentComment(404, "evidence", true).join())
        .isEqualTo(Result.err(TicketFailure.TICKET_NOT_FOUND));
    assertThat(service.addAgentComment(opened.id(), "  ", true).join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
  }

  @Test
  void agentTriageAttachesAndRejectsBadInput() {
    var opened = agentOk(service.openAgentReport("chat", "spam burst in global").join());

    var attached =
        agentOk(
            service
                .attachAgentTriage(
                    opened.id(), new AgentTriage("urgent", List.of(), "bursts nightly", "hi"))
                .join());
    assertThat(attached.priorityId()).isEqualTo("urgent");
    assertThat(attached.triage().orElseThrow().evidence()).isEqualTo("bursts nightly");

    assertThat(
            service
                .attachAgentTriage(opened.id(), new AgentTriage("extreme", List.of(), "x", "y"))
                .join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
    assertThat(
            service.attachAgentTriage(404, new AgentTriage("urgent", List.of(), "x", "y")).join())
        .isEqualTo(Result.err(TicketFailure.TICKET_NOT_FOUND));
  }

  @Test
  void agentResolveClosesWithAPublicNote() {
    var opened = agentOk(service.openAgentReport("chat", "spam burst in global").join());

    var resolved = agentOk(service.resolveAgentTicket(opened.id(), "muted, thanks").join());
    assertThat(resolved.statusId()).isEqualTo("resolved");
    assertThat(service.commentSnapshots(opened.id()).join())
        .extracting(CommentSnapshot::body)
        .containsExactly("muted, thanks");

    assertThat(service.resolveAgentTicket(opened.id(), "again").join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
    assertThat(service.resolveAgentTicket(404, "nope").join())
        .isEqualTo(Result.err(TicketFailure.INVALID_INPUT));
  }

  @Test
  void agentEscalateMovesToEscalatedWithAStaffNote() {
    var opened = service.open(draft()).join();

    var escalated = agentOk(service.escalateAgentTicket(opened.id(), "sla-breach").join());

    assertThat(escalated.statusId()).isEqualTo("escalated");
    assertThat(service.commentSnapshots(opened.id()).join())
        .extracting(CommentSnapshot::body)
        .containsExactly("sla-breach");
    assertThat(service.commentSnapshots(opened.id()).join().getFirst().staffOnly()).isTrue();
  }

  @Test
  void openSnapshotsListsOnlyOpenTickets() {
    var first = service.open(draft()).join();
    var second = service.open(draft()).join();
    service.resolveAgentTicket(second.id(), "done").join();

    assertThat(service.openSnapshots().join())
        .extracting(TicketSnapshot::id)
        .containsExactly(first.id());
  }

  private static <T> T agentOk(Result<T, TicketFailure> result) {
    return switch (result) {
      case Result.Ok<T, TicketFailure>(var value) -> value;
      case Result.Err<T, TicketFailure>(var failure) ->
          throw new AssertionError("expected success, got " + failure);
    };
  }
}
