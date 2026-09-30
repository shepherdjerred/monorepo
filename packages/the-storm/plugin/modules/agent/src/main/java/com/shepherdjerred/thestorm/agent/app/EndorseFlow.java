package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Marks agent decisions reviewed-as-good at reviewer request. Endorsing clears a row from the
 * review queue the way overturning does, but it undoes nothing and writes no correction: agreement
 * needs no note. An overturned row cannot be endorsed; praise for a reversed call is a
 * contradiction.
 */
public final class EndorseFlow {

  /** What endorsing reported. */
  public sealed interface Outcome {

    /** No decision with that id. */
    record Missing(long id) implements Outcome {}

    /** Already overturned; states who did it. */
    record AlreadyOverturned(AgentDecision decision, UUID by) implements Outcome {}

    /** Already endorsed; states who did it. */
    record AlreadyEndorsed(AgentDecision decision, UUID by) implements Outcome {}

    /** Endorsed. */
    record Endorsed(AgentDecision decision) implements Outcome {}
  }

  private final AgentServices services;

  public EndorseFlow(AgentServices services) {
    this.services = services;
  }

  /** Endorses decision {@code id} as {@code staff}. */
  public CompletableFuture<Outcome> endorse(long id, UUID staff) {
    return services
        .log()
        .find(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(new Outcome.Missing(id));
              }
              var decision = found.orElseThrow();
              if (decision.overturnedBy().isPresent()) {
                return CompletableFuture.completedFuture(
                    new Outcome.AlreadyOverturned(decision, decision.overturnedBy().orElseThrow()));
              }
              if (decision.endorsedBy().isPresent()) {
                return CompletableFuture.completedFuture(
                    new Outcome.AlreadyEndorsed(decision, decision.endorsedBy().orElseThrow()));
              }
              // The row existed a moment ago and rows are never deleted, so the mark lands.
              return services
                  .log()
                  .endorse(decision.id(), staff, services.time().instant())
                  .thenApply(marked -> new Outcome.Endorsed(decision));
            });
  }
}
