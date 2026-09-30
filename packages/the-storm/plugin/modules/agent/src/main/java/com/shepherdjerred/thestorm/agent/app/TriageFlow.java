package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.agent.domain.Sampler;
import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.tickets.app.AgentTriage;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Works new tickets. Each filing is assembled with its comments, the reporter's moderation history
 * and standing, and their recent chat, then handed to the brain. Confident triage attaches to the
 * ticket; convincing resolutions close it; anything else stays in the human queue.
 *
 * <p>The flow skips the agent's own escalation tickets: they are already worked. Unlike
 * enforcement, triage records after its ticket writes, so the decision row states the actual
 * outcome; both hit the same database, so a failure surfaces through the module log either way.
 *
 * <p>Without the essentials module there is no moderation history and nothing can ban, so history
 * reads empty and reporters count as unbanned rather than failing the flow.
 */
public final class TriageFlow {

  private static final int HISTORY_LINES = 5;
  private static final int CHAT_LINES = 10;

  private final RecentChat recents;
  private final Optional<ModerationService> moderation;
  private final AgentServices services;

  public TriageFlow(
      RecentChat recents, Optional<ModerationService> moderation, AgentServices services) {
    this.recents = recents;
    this.moderation = moderation;
    this.services = services;
  }

  /** Handles a ticket event; only filings are worked. */
  public CompletableFuture<Void> onEvent(TicketEvent event) {
    if (!(event instanceof TicketEvent.Opened(var ticket))) {
      return CompletableFuture.completedFuture(null);
    }
    if (ticket.reporter().equals(TicketService.SYSTEM_REPORTER)) {
      return CompletableFuture.completedFuture(null);
    }
    return triage(ticket);
  }

  private CompletableFuture<Void> triage(TicketSnapshot ticket) {
    var reporter = ticket.reporter();
    var comments = services.tickets().commentSnapshots(ticket.id());
    var history =
        moderation
            .map(moderate -> moderate.historyView(reporter, HISTORY_LINES))
            .orElseGet(() -> CompletableFuture.completedFuture(List.of()));
    var banned =
        moderation
            .map(moderate -> moderate.activeBan(reporter).thenApply(Optional::isPresent))
            .orElseGet(() -> CompletableFuture.completedFuture(false));
    var chat = recents.lastBy(reporter, CHAT_LINES).stream().map(TriageFlow::sample).toList();
    return CompletableFuture.allOf(comments, history, banned)
        .thenCompose(
            done ->
                services
                    .brain()
                    .triage(
                        new TriageCase(
                            ticket, comments.join(), history.join(), banned.join(), chat))
                    .thenCompose(proposal -> settle(ticket, proposal))
                    // A switched-off flow is steady state: the ticket stays unworked.
                    .exceptionallyCompose(
                        failure ->
                            BrainDisabledException.isCauseOf(failure)
                                ? CompletableFuture.completedFuture(null)
                                : CompletableFuture.failedFuture(failure)));
  }

  private CompletableFuture<Void> settle(TicketSnapshot ticket, TriageProposal proposal) {
    var config = services.config();
    if (config.shadow()) {
      var wouldAttach = proposal.confidence() >= config.triageThreshold();
      var wouldResolve = proposal.resolve() && proposal.confidence() >= config.resolveThreshold();
      return record(
          ticket,
          proposal,
          wouldResolve ? DecisionAction.ALLOW : DecisionAction.ESCALATE,
          (wouldAttach ? "would-attach " : "below-threshold ")
              + (wouldResolve ? "would-resolve" : "open"));
    }
    return attach(ticket, proposal)
        .thenCompose(
            attachOutcome ->
                resolve(ticket, proposal)
                    .thenCompose(
                        resolveOutcome ->
                            record(
                                ticket,
                                proposal,
                                resolveOutcome.equals("resolved")
                                    ? DecisionAction.ALLOW
                                    : DecisionAction.ESCALATE,
                                attachOutcome + " " + resolveOutcome)));
  }

  private CompletableFuture<String> attach(TicketSnapshot ticket, TriageProposal proposal) {
    if (proposal.confidence() < services.config().triageThreshold()) {
      return CompletableFuture.completedFuture("skipped");
    }
    return services
        .tickets()
        .attachAgentTriage(ticket.id(), agentTriage(proposal))
        .thenApply(
            result ->
                result instanceof Result.Ok<TicketSnapshot, TicketFailure>
                    ? "attached"
                    : "rejected");
  }

  private CompletableFuture<String> resolve(TicketSnapshot ticket, TriageProposal proposal) {
    if (!proposal.resolve() || proposal.confidence() < services.config().resolveThreshold()) {
      return CompletableFuture.completedFuture("open");
    }
    return services
        .tickets()
        .resolveAgentTicket(
            ticket.id(), Notes.clip(proposal.resolutionNote(), TicketService.MAX_AGENT_COMMENT))
        .thenApply(
            result ->
                result instanceof Result.Ok<TicketSnapshot, TicketFailure>
                    ? "resolved"
                    : "resolve-rejected");
  }

  private CompletableFuture<Void> record(
      TicketSnapshot ticket, TriageProposal proposal, DecisionAction action, String outcome) {
    return services
        .log()
        .record(
            new DecisionDraft(
                ticket.reporter(),
                Offense.OTHER,
                Optional.of(ticket.id()),
                "triage",
                proposal.confidence(),
                Notes.clip(proposal.model(), AgentDecision.MAX_LABEL_LENGTH),
                action,
                services.config().shadow(),
                Sampler.shouldSample(services.random(), services.config().reviewSamplePercent()),
                Optional.empty(),
                proposal.costMicros(),
                Notes.clip(
                    outcome + " " + proposal.priorityId() + ": " + proposal.evidence(),
                    AgentDecision.MAX_NOTE_LENGTH)),
            services.time().instant())
        .thenApply(done -> null);
  }

  private static AgentTriage agentTriage(TriageProposal proposal) {
    return new AgentTriage(
        proposal.priorityId(),
        proposal.duplicates(),
        Notes.clip(proposal.evidence(), TicketService.MAX_AGENT_TRIAGE_TEXT),
        Notes.clip(proposal.draftReply(), TicketService.MAX_AGENT_TRIAGE_TEXT));
  }

  private static ChatSample sample(ChatLine line) {
    if (!(line.author() instanceof ChatAuthor.InGame(var id, var name))) {
      throw new IllegalStateException("recent chat by id is always in-game");
    }
    return new ChatSample(id, name, line.text(), line.at());
  }
}
