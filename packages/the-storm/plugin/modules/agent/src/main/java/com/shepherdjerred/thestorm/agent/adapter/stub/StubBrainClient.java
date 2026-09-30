package com.shepherdjerred.thestorm.agent.adapter.stub;

import com.shepherdjerred.thestorm.agent.app.BrainClient;
import com.shepherdjerred.thestorm.agent.app.ClassifyCase;
import com.shepherdjerred.thestorm.agent.app.ClassifyVerdict;
import com.shepherdjerred.thestorm.agent.app.TriageCase;
import com.shepherdjerred.thestorm.agent.app.TriageProposal;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * A brain that answers from a script. Tests program the verdicts; production always calls the HTTP
 * brain, and this stays behind for the flows' unit tests.
 */
public final class StubBrainClient implements BrainClient {

  private final Function<ClassifyCase, ClassifyVerdict> classify;
  private final Function<TriageCase, TriageProposal> triage;

  public StubBrainClient(
      Function<ClassifyCase, ClassifyVerdict> classify,
      Function<TriageCase, TriageProposal> triage) {
    this.classify = classify;
    this.triage = triage;
  }

  /** Uncertain about everything: clean chats, unworked tickets, no cost. */
  public static StubBrainClient defaultUncertain() {
    return new StubBrainClient(
        kase -> new ClassifyVerdict(Optional.empty(), 0, "uncertain", "stub", "stub", 0),
        kase -> new TriageProposal("normal", 0, List.of(), "stub", "stub", false, "", "stub", 0));
  }

  @Override
  public CompletableFuture<ClassifyVerdict> classify(ClassifyCase kase) {
    return CompletableFuture.completedFuture(classify.apply(kase));
  }

  @Override
  public CompletableFuture<TriageProposal> triage(TriageCase kase) {
    return CompletableFuture.completedFuture(triage.apply(kase));
  }
}
