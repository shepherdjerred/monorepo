package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.FaqEntry;
import com.shepherdjerred.thestorm.agent.domain.FaqMatcher;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.agent.domain.Sampler;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.app.CommentSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * Answers known questions from the catalog, without spending a model call. A new ticket naming an
 * entry's keyword gets the entry's reply; a repeat asker whose decayed hits reach the third strike
 * gets the reply cut to its short version. Every answer signs its entry, so a sweep redrive never
 * answers twice.
 *
 * <p>In shadow mode the flow records what it would have posted and posts nothing.
 */
public final class FaqFlow {

  /** What a staff-forced answer reported. */
  public sealed interface AnswerOutcome {

    /** No ticket with that id. */
    record Missing(long ticketId) implements AnswerOutcome {}

    /** No catalog entry with that id. */
    record UnknownEntry(String entryId) implements AnswerOutcome {}

    /** Nothing in the catalog matches the ticket. */
    record NoMatch(long ticketId) implements AnswerOutcome {}

    /** Answered with the entry. */
    record Answered(long ticketId, String entryId) implements AnswerOutcome {}
  }

  /** Remembered askings that cut the next reply. */
  static final int STRIKES_TO_CUT = 2;

  /** The longest short version kept. */
  static final int SHORT_LENGTH = 200;

  private static final String MODEL = "faq-catalog";
  private static final String TAG = "Storm FAQ: ";

  private final FaqMemory memory;
  private final AgentServices services;

  public FaqFlow(FaqMemory memory, AgentServices services) {
    this.memory = memory;
    this.services = services;
  }

  /** Answers a filing from the catalog; only filings from players are matched. */
  public CompletableFuture<Void> onEvent(TicketEvent event) {
    if (!(event instanceof TicketEvent.Opened(var ticket))) {
      return CompletableFuture.completedFuture(null);
    }
    if (!services.config().faq().enabled()) {
      return CompletableFuture.completedFuture(null);
    }
    if (ticket.reporter().equals(TicketService.SYSTEM_REPORTER)) {
      return CompletableFuture.completedFuture(null);
    }
    return services
        .tickets()
        .commentSnapshots(ticket.id())
        .thenCompose(comments -> match(ticket, comments));
  }

  /** Answers ticket {@code ticketId}: the named entry, or the catalog's match. */
  public CompletableFuture<AnswerOutcome> answer(long ticketId, Optional<String> entryId) {
    return services
        .tickets()
        .snapshot(ticketId)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(new AnswerOutcome.Missing(ticketId));
              }
              var ticket = found.orElseThrow();
              if (entryId.isPresent()) {
                var named = byId(entryId.orElseThrow());
                if (named.isEmpty()) {
                  return CompletableFuture.completedFuture(
                      new AnswerOutcome.UnknownEntry(entryId.orElseThrow()));
                }
                return post(ticket, named.orElseThrow(), false, true)
                    .thenApply(
                        done -> new AnswerOutcome.Answered(ticketId, named.orElseThrow().id()));
              }
              return services
                  .tickets()
                  .commentSnapshots(ticketId)
                  .thenCompose(
                      comments -> {
                        var match = FaqMatcher.match(textOf(ticket, comments), entries());
                        if (match.isEmpty()) {
                          return CompletableFuture.completedFuture(
                              new AnswerOutcome.NoMatch(ticketId));
                        }
                        return post(ticket, match.orElseThrow(), false, true)
                            .thenApply(
                                done ->
                                    new AnswerOutcome.Answered(ticketId, match.orElseThrow().id()));
                      });
            });
  }

  private CompletableFuture<Void> match(TicketSnapshot ticket, List<CommentSnapshot> comments) {
    var match = FaqMatcher.match(textOf(ticket, comments), entries());
    if (match.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    var entry = match.orElseThrow();
    if (answered(comments, entry.id())) {
      return CompletableFuture.completedFuture(null);
    }
    var now = services.time().instant();
    var halfLife = Duration.ofHours(services.config().faq().halfLifeHours());
    var cut = memory.strikes(ticket.reporter(), entry.id(), now, halfLife) >= STRIKES_TO_CUT;
    if (services.config().shadow()) {
      memory.recordHit(ticket.reporter(), entry.id(), now, halfLife);
      return record(ticket, entry, cut, "would-reply").thenApply(done -> null);
    }
    return post(ticket, entry, cut, false).thenApply(done -> null);
  }

  private CompletableFuture<Void> post(
      TicketSnapshot ticket, FaqEntry entry, boolean cut, boolean staffForced) {
    var body = Notes.clip(bodyFor(entry, cut), TicketService.MAX_AGENT_COMMENT);
    return services
        .tickets()
        .addAgentComment(ticket.id(), body, false)
        .thenCompose(
            added ->
                switch (added) {
                  case Result.Ok<CommentSnapshot, TicketFailure> _ -> {
                    var now = services.time().instant();
                    memory.recordHit(
                        ticket.reporter(),
                        entry.id(),
                        now,
                        Duration.ofHours(services.config().faq().halfLifeHours()));
                    yield record(ticket, entry, cut, staffForced ? "staff-forced" : "replied")
                        .thenApply(done -> null);
                  }
                  // The ticket moved on while the answer posted; nothing to do.
                  case Result.Err<CommentSnapshot, TicketFailure> _ ->
                      CompletableFuture.completedFuture(null);
                });
  }

  private CompletableFuture<AgentDecision> record(
      TicketSnapshot ticket, FaqEntry entry, boolean cut, String outcome) {
    return services
        .log()
        .record(
            new DecisionDraft(
                ticket.reporter(),
                Offense.OTHER,
                Optional.of(ticket.id()),
                "faq",
                1,
                MODEL,
                DecisionAction.ALLOW,
                services.config().shadow(),
                Sampler.shouldSample(services.random(), services.config().reviewSamplePercent()),
                Optional.empty(),
                0,
                Notes.clip(
                    outcome + " " + entry.id() + (cut ? " cut" : " full"),
                    AgentDecision.MAX_NOTE_LENGTH)),
            services.time().instant());
  }

  private Optional<FaqEntry> byId(String entryId) {
    return entries().stream().filter(entry -> entry.id().equals(entryId)).findFirst();
  }

  private List<FaqEntry> entries() {
    return services.config().faq().entries().stream()
        .map(AgentConfig.FaqEntryFile::toDomain)
        .toList();
  }

  private static String textOf(TicketSnapshot ticket, List<CommentSnapshot> comments) {
    return ticket.summary()
        + "\n"
        + comments.stream().map(CommentSnapshot::body).collect(Collectors.joining("\n"));
  }

  private static boolean answered(List<CommentSnapshot> comments, String entryId) {
    return comments.stream()
        .map(CommentSnapshot::body)
        .anyMatch(body -> body.contains(TAG + entryId));
  }

  private static String bodyFor(FaqEntry entry, boolean cut) {
    var answer = entry.reply();
    if (!entry.link().isBlank()) {
      answer += "\n" + entry.link();
    }
    if (cut) {
      answer = shortVersion(entry);
    }
    return answer + "\n\n— " + TAG + entry.id();
  }

  private static String shortVersion(FaqEntry entry) {
    if (!entry.link().isBlank()) {
      return "You've asked this before — the short version: " + entry.link();
    }
    var reply = entry.reply();
    var end = reply.length();
    for (var i = 0; i < reply.length(); i++) {
      var mark = reply.charAt(i);
      if (mark == '.' || mark == '!' || mark == '?') {
        end = i + 1;
        break;
      }
    }
    return "You've asked this before — the short version: "
        + Notes.clip(reply.substring(0, end).strip(), SHORT_LENGTH);
  }
}
