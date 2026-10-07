package com.shepherdjerred.thestorm.rwfbots.app.learning;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatCommands;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;
import org.jspecify.annotations.Nullable;

/** Main-thread ordinary-match owner. Pending and unavailable actions preserve the authored step. */
public final class MatchLearning implements AutoCloseable {
  public record Parts(
      LearningGate gate, AcceptedInference models, Consumer<LearningGate.Decision> observed) {}

  public enum State {
    IDLE,
    PENDING_GATE,
    OFF,
    PENDING_MODEL,
    ON,
    FAILED
  }

  public record Metrics(
      State state,
      long applied,
      long unavailable,
      long ineligible,
      long pendingTicks,
      long gateUnavailable,
      long modelRejected,
      Optional<BatchedInference.Metrics> inference) {}

  private static final class Match {
    final LearningGate.Context context;
    @Nullable CompletableFuture<LearningGate.Decision> decision;
    @Nullable CompletableFuture<BatchedInference> loading;
    @Nullable BatchedInference model;

    Match(LearningGate.Context context, CompletableFuture<LearningGate.Decision> decision) {
      this.context = context;
      this.decision = decision;
    }
  }

  private final Parts parts;
  private final List<InferenceRequest> requests = new ArrayList<>();
  private @Nullable Match match;
  private @Nullable BatchedInference latestModel;
  private long applied;
  private long unavailable;
  private long ineligible;
  private long pendingTicks;
  private long gateUnavailable;
  private long modelRejected;
  private boolean closed;

  public MatchLearning(Parts parts) {
    this.parts = parts;
  }

  public void begin(LearningGate.Context context) {
    if (closed || match != null)
      throw new IllegalStateException("learning match lifecycle differs");
    match = new Match(context, parts.gate().evaluate(context));
  }

  public void end() {
    var current = match;
    match = null;
    requests.clear();
    var model = latestModel;
    if (model != null && current != null) model.reset(new SplittableRandom(current.context.seed()));
  }

  public void startTick(long tick) {
    requests.clear();
    var current = match;
    if (current == null) {
      idle(tick);
      return;
    }
    resolveGate(current);
    resolveModel(current);
    if (current.decision != null || current.loading != null) pendingTicks++;
    if (current.model == null) idle(tick);
  }

  private void resolveGate(Match current) {
    var decision = current.decision;
    if (decision != null && decision.isDone()) {
      var answer = decision.getNow(null);
      if (answer == null) throw new IllegalStateException("missing completed learning flag");
      parts.observed().accept(answer);
      if (answer.source() == LearningGate.Source.UNAVAILABLE) gateUnavailable++;
      if (answer.enabled()) {
        try {
          current.loading = parts.models().load();
        } catch (RejectedExecutionException unavailablePool) {
          modelRejected++;
        }
      }
      current.decision = null;
    }
  }

  private void resolveModel(Match current) {
    var loading = current.loading;
    if (loading != null && loading.isDone()) {
      var model = loading.getNow(null);
      if (model == null) throw new IllegalStateException("missing loaded accepted actor");
      model.reset(new SplittableRandom(current.context.seed()));
      current.model = model;
      latestModel = model;
      current.loading = null;
    }
  }

  private void idle(long tick) {
    var model = latestModel;
    if (model != null) model.tick(tick, List.of());
  }

  public boolean active(UUID matchId) {
    var current = match;
    return current != null && current.context.match().equals(matchId) && current.model != null;
  }

  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    var current = match;
    if (current == null || !current.context.match().equals(frame.matchId()))
      return frame.authored().commands();
    var model = current.model;
    if (model == null || frame.input().self().kit() != Kit.TROOPER)
      return frame.authored().commands();
    var observation = frame.observation();
    if (observation.isEmpty()) {
      unavailable++;
      return frame.authored().commands();
    }
    if (!observation
        .orElseThrow()
        .contract()
        .equals(com.shepherdjerred.thestorm.rwfbots.domain.learning.ObservationContract.ID))
      throw new IllegalArgumentException("ordinary inference observation contract differs");
    var request =
        new InferenceRequest(
            new InferenceRequest.Identity(
                frame.matchId(), frame.body(), frame.life(), frame.input().self().kit()),
            frame.input().snapshot().tick(),
            frame.input().self().yaw(),
            observation.orElseThrow().values());
    requests.add(request);
    var action = model.action(request);
    if (!CombatCommands.eligible(frame.authored().commands(), frame.input())) {
      ineligible++;
      return frame.authored().commands();
    }
    if (action.isEmpty()) {
      unavailable++;
      return frame.authored().commands();
    }
    applied++;
    return CombatCommands.replace(frame.authored().commands(), frame.input(), action.orElseThrow());
  }

  public void finishTick(UUID matchId, long tick) {
    var current = match;
    if (current == null || !current.context.match().equals(matchId)) return;
    var model = current.model;
    if (model != null) model.tick(tick, List.copyOf(requests));
  }

  public Metrics metrics() {
    var model = latestModel;
    return new Metrics(
        state(),
        applied,
        unavailable,
        ineligible,
        pendingTicks,
        gateUnavailable,
        modelRejected,
        model == null ? Optional.empty() : Optional.of(model.metrics()));
  }

  private State state() {
    var current = match;
    if (current == null) return State.IDLE;
    var decision = current.decision;
    if (decision != null)
      return decision.isCompletedExceptionally() ? State.FAILED : State.PENDING_GATE;
    var loading = current.loading;
    if (loading != null)
      return loading.isCompletedExceptionally() ? State.FAILED : State.PENDING_MODEL;
    return current.model == null ? State.OFF : State.ON;
  }

  @Override
  public void close() {
    if (closed) return;
    closed = true;
    end();
    parts.gate().close();
  }
}
