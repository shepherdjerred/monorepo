package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The agent's memory: every decision, for supervision, strikes, and appeals. Every call is
 * asynchronous; the single writer thread applies writes in the order they arrive.
 */
public interface DecisionLog {

  /** Records {@code draft} at {@code at}, assigning the next id. */
  CompletableFuture<AgentDecision> record(DecisionDraft draft, Instant at);

  /** The decision with {@code id}, when it exists. */
  CompletableFuture<Optional<AgentDecision>> find(long id);

  /** Strikes against {@code player} for {@code offense} since {@code since}. */
  CompletableFuture<Integer> strikes(UUID player, Offense offense, Instant since);

  /** Marks decision {@code id} overturned by {@code staff} at {@code at}. */
  CompletableFuture<Boolean> overturn(long id, UUID staff, Instant at);

  /** Marks decision {@code id} endorsed by {@code staff} at {@code at}. */
  CompletableFuture<Boolean> endorse(long id, UUID staff, Instant at);

  /** The newest {@code limit} decisions, newest first. */
  CompletableFuture<List<AgentDecision>> recent(int limit);

  /**
   * The newest decisions with action ESCALATE, newest first: the review queue. Reviewed rows leave
   * the queue, whether overturned or endorsed.
   */
  CompletableFuture<List<AgentDecision>> escalations(int limit);

  /**
   * The newest sampled decisions with any other action, newest first: the spot-check queue.
   * Escalations queue by action instead, so a row never appears in both. Reviewed rows leave.
   */
  CompletableFuture<List<AgentDecision>> samples(int limit);

  /** Decisions linked to ticket {@code ticketId}, oldest first: the ticket's agent trail. */
  CompletableFuture<List<AgentDecision>> decisionsForTicket(long ticketId);

  /** {@code player}'s newest {@code limit} decisions, newest first. */
  CompletableFuture<List<AgentDecision>> recentBy(UUID player, int limit);
}
