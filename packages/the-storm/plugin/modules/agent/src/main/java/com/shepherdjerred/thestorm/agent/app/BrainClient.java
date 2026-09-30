package com.shepherdjerred.thestorm.agent.app;

import java.util.concurrent.CompletableFuture;

/**
 * The agent's brain: classifies chat and triages tickets. The plugin never blocks on it; every call
 * returns a future the flows compose. Implementations report their own model and cost, which land
 * on the decision record.
 *
 * <p>A failed future carries {@link BrainException} for a broken call and {@link
 * BrainDisabledException} when the flow is switched off; the flows complete silently on the latter.
 * Either way a failed call never yields a verdict.
 */
public interface BrainClient {

  /** Classifies a player's recent chat. */
  CompletableFuture<ClassifyVerdict> classify(ClassifyCase kase);

  /** Works a ticket: priority, duplicates, evidence, and a draft reply. */
  CompletableFuture<TriageProposal> triage(TriageCase kase);
}
